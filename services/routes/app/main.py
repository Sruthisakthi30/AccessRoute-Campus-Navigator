import os
import heapq
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

LOCATION_URL = os.getenv('LOCATION_SERVICE_URL', 'http://localhost:4001').rstrip('/')
app = FastAPI(title='AccessRoute Route & Accessibility Service', version='1.0.0', description='Preference-aware campus route calculation using the location service graph.')
app.add_middleware(CORSMiddleware, allow_origins=os.getenv('CLIENT_ORIGIN', 'http://localhost:5173').split(','), allow_methods=['*'], allow_headers=['*'])

class Preferences(BaseModel):
    avoidStairs: bool = True
    preferRamps: bool = True
    preferElevators: bool = True

class RouteRequest(BaseModel):
    from_: str = Field(alias='from', min_length=1, max_length=80)
    to: str = Field(min_length=1, max_length=80)
    preferences: Preferences = Preferences()

async def get_graph():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f'{LOCATION_URL}/api/graph')
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail='Campus location service is unavailable. Please try again shortly.') from exc

@app.get('/health')
async def health():
    location = 'connected'
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f'{LOCATION_URL}/api/health')
            if r.status_code >= 400: location = 'unavailable'
    except httpx.HTTPError:
        location = 'unavailable'
    return {'status': 'ok' if location == 'connected' else 'degraded', 'service': 'route-accessibility', 'locationService': location}

@app.get('/api/locations')
async def locations():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f'{LOCATION_URL}/api/locations'); r.raise_for_status(); return r.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail='Campus location service is unavailable.') from exc

@app.post('/api/routes')
async def calculate_route(request: RouteRequest):
    graph = await get_graph()
    by_id = {item['id']: item for item in graph.get('locations', [])}
    start, finish = request.from_, request.to
    if start not in by_id: raise HTTPException(status_code=404, detail=f'Start location "{start}" was not found.')
    if finish not in by_id: raise HTTPException(status_code=404, detail=f'Destination "{finish}" was not found.')
    if start == finish: raise HTTPException(status_code=400, detail='Choose two different locations.')
    prefs = request.preferences
    adjacency = {key: [] for key in by_id}
    for edge in graph.get('paths', []):
        if edge.get('blocked') or edge.get('from') not in by_id or edge.get('to') not in by_id: continue
        if prefs.avoidStairs and edge.get('stairs'): continue
        # A small preference penalty rewards accessible alternatives without making a ramp-only
        # route impossible when it is the only available connection.
        weight = float(edge.get('distance', 1))
        if prefs.preferRamps and edge.get('ramp'): weight *= 0.90
        if prefs.preferElevators and edge.get('elevator'): weight *= 0.94
        if not edge.get('ramp') and not edge.get('elevator') and (prefs.preferRamps or prefs.preferElevators): weight *= 1.08
        adjacency[edge['from']].append((edge['to'], weight, edge))
        adjacency[edge['to']].append((edge['from'], weight, edge))
    distances, previous = {start: 0}, {}
    queue = [(0, start)]
    while queue:
        cost, current = heapq.heappop(queue)
        if cost != distances.get(current): continue
        if current == finish: break
        for neighbor, weight, edge in adjacency.get(current, []):
            candidate = cost + weight
            if candidate < distances.get(neighbor, float('inf')):
                distances[neighbor] = candidate; previous[neighbor] = (current, edge); heapq.heappush(queue, (candidate, neighbor))
    if finish not in distances:
        raise HTTPException(status_code=404, detail='No route matches these accessibility preferences. Try another destination or adjust preferences.')
    ids, used_edges, cursor = [finish], [], finish
    while cursor != start:
        parent, edge = previous[cursor]; used_edges.append(edge); ids.append(parent); cursor = parent
    ids.reverse(); used_edges.reverse()
    distance = sum(float(edge.get('distance', 0)) for edge in used_edges)
    minutes = max(1, round(distance / 75))
    notes = []
    if any(edge.get('ramp') for edge in used_edges): notes.append('Ramp access available along part of this route.')
    if any(edge.get('elevator') for edge in used_edges): notes.append('Elevator connection included.')
    if any(edge.get('stairs') for edge in used_edges): notes.append('This route includes stairs.')
    notes.append('Blocked pathways were excluded from route calculation.')
    return {'from': by_id[start], 'to': by_id[finish], 'waypoints': [by_id[i] for i in ids], 'segments': used_edges, 'distanceMeters': round(distance), 'estimatedMinutes': minutes, 'preferences': prefs.model_dump(), 'notes': notes, 'generatedAt': graph.get('generatedAt')}
