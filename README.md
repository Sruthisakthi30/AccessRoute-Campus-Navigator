# AccessRoute — Accessibility-aware campus navigation

AccessRoute helps students, staff and visitors find practical routes across a campus, including routes that avoid stairs, prefer ramps or elevators, and exclude blocked paths. The repository contains a React client and two independently deployable REST services.

## Architecture

```text
React/Vite web client
  ├── Campus Location Service (Node.js + Express, port 4001) ── MongoDB
  └── Route & Accessibility Service (Python + FastAPI, port 8000)
        └── calls the Location Service REST API for live nodes and pathways
```

The route service uses Dijkstra's shortest-path algorithm with preference-aware edge weights and hard constraints for blocked paths and stairs when requested. Location data is stored in MongoDB. The location service seeds a small demo campus on first access when the database is empty.

## Run locally

Requirements: Docker Desktop (recommended), or Node.js 20+, Python 3.11+, and MongoDB.

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Run `docker compose up --build` from this directory.
3. Open [http://localhost:5173](http://localhost:5173). API docs: [http://localhost:8000/docs](http://localhost:8000/docs); location health: [http://localhost:4001/api/health](http://localhost:4001/api/health).

For running without Docker, start MongoDB on `localhost:27017`. Set `MONGODB_URI=mongodb://localhost:27017`, `DB_NAME=accessroute`, `PORT=4001`, and `CLIENT_ORIGIN=http://localhost:5173` in the location-service shell before starting it. Set `LOCATION_SERVICE_URL=http://localhost:4001`, `CLIENT_ORIGIN=http://localhost:5173`, and `PORT=8000` in the route-service shell. In the frontend shell set `VITE_ROUTE_API_URL=http://localhost:8000` and `VITE_LOCATION_API_URL=http://localhost:4001`. Then run `npm install && npm run dev` in `frontend/`, `npm install && npm run dev` in `services/location/`, and `python -m venv .venv` followed by `pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000` in `services/routes/`.

## API overview

### Campus Location Service (`/api`)

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/locations` | List campus locations |
| POST | `/api/locations` | Create location |
| GET | `/api/locations/:id` | Get one location |
| PUT | `/api/locations/:id` | Update location |
| DELETE | `/api/locations/:id` | Delete location |
| GET | `/api/paths` | List pathways (supports `?includeBlocked=true`) |
| POST | `/api/paths` | Create pathway |
| PUT | `/api/paths/:id` | Update pathway |
| DELETE | `/api/paths/:id` | Delete pathway |
| GET | `/api/graph` | Return locations and traversable pathways for routing |
| GET | `/api/health` | Health check |
| POST | `/api/auth/register` | Create a student account and return a signed session token |
| POST | `/api/auth/login` | Sign in with email and password |
| GET | `/api/auth/me` | Validate the current student session (`Authorization: Bearer <token>`) |

### Route & Accessibility Service

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/routes` | Calculate accessible route between location IDs |
| GET | `/api/locations` | Proxy location list from Location Service |
| GET | `/health` | Health check and location-service status |

Example route request:

```json
{
  "from": "north-gate",
  "to": "library",
  "preferences": { "avoidStairs": true, "preferRamps": true, "preferElevators": true }
}
```

The route response includes ordered waypoints, pathway details, total distance, estimated walk time, accessibility notes, and a clear error when no usable route exists. Distances and travel times are demo estimates, not live positioning or indoor GPS.

## Postman / API testing

Import `docs/AccessRoute.postman_collection.json` into Postman. Set `locationUrl` to `http://localhost:4001` and `routeUrl` to `http://localhost:8000`, then run the student registration/sign-in/session requests, health checks, list, route, and CRUD requests. Registration generates a unique test student account for each run.

## Deployment guide

Deploy the two services as separate web services (for example Render, Railway, or an equivalent platform), and provision MongoDB Atlas. Configure:

* **Location service:** `MONGODB_URI`, `DB_NAME`, `JWT_SECRET`, `PORT`, `CLIENT_ORIGIN`.
* **Route service:** `LOCATION_SERVICE_URL` set to the deployed location-service base URL, `CLIENT_ORIGIN`, `PORT`.
* **Frontend:** `VITE_ROUTE_API_URL` set to the deployed route service URL. For the UI's operational status and map metadata it also uses `VITE_LOCATION_API_URL` set to the deployed location service URL.

Build commands: location `npm install && npm start`; route `pip install -r requirements.txt && uvicorn app.main:app --host 0.0.0.0 --port $PORT`; frontend `npm install && npm run build` with `dist/` as the publish directory. Add each deployed URL to this document after deployment. Cloud accounts and credentials are not available in this workspace, so deployment links must be filled in by the project owner after creating the services.

Student accounts are stored in the `student_accounts` MongoDB collection. Passwords use per-account random salts and Node.js scrypt hashes; the browser stores only a short-lived signed bearer token in session storage. Set a unique, long `JWT_SECRET` for each deployed environment and never commit it. The built-in fallback secret is for local development only. Student sign-in identifies the user in the interface; role-based authorization for campus administration is not yet implemented.

## Project report and demonstration

The application demonstrates two independent services, CRUD backed by MongoDB, REST-based service-to-service graph retrieval, preference-aware Dijkstra routing, client/API integration, and failure handling. For a short demo: select a start and destination, compare the accessible route and distance, toggle a preference, inspect a blocked-path notice, then open **Manage campus** and add/edit/delete a location or pathway. Explain that route-service requests fetch the current graph from the location service on each calculation.

Suggested report sections: problem statement and users; architecture diagram; data model; endpoint table; Dijkstra and accessibility rules; UI screenshots; Postman evidence; deployment URLs; limitations/future work. Sample campus data, elapsed time and geometry are illustrative; field deployment should use surveyed campus paths and verify routes with disabled users.
