# AccessRoute — Mini project report

## Abstract

AccessRoute is an accessibility-aware campus navigation application. Students can create an account and sign in, then choose a start and destination, set route preferences, and see a campus path with distance, estimated walking time, and campus waypoints. Campus staff can maintain locations and pathways, including recording temporary closures.

## Problem and objectives

Large campuses can be difficult to navigate, and the shortest route may include stairs or a closed walkway. AccessRoute aims to make route information easier to use and to make accessibility constraints visible in route planning. It demonstrates a full-stack application, independent microservices, REST communication, database CRUD, and an algorithmic route planner.

## Architecture and technology

The React interface is a separate client. The Node.js/Express Campus Location Service owns location and pathway data in MongoDB and exposes CRUD endpoints plus a graph endpoint. The Python/FastAPI Route & Accessibility Service requests the current graph over REST on every route calculation, filters blocked pathways and (when selected) stairways, then runs Dijkstra's algorithm. It returns the waypoint sequence, segments, distance, estimated minutes, applied preferences, and accessibility notes.

```text
React + Vite  ──REST──>  Route & Accessibility Service (FastAPI)
     │                         │
     └────────REST─────────────┴──> Campus Location Service (Express) ──> MongoDB
```

## Data model

* **Location:** ID, name, type (`building`, `entrance`, or `landmark`), description, illustrative map coordinates, and step-free access verification.
* **Pathway:** ID, endpoint location IDs, distance in meters, surface, stair/ramp/elevator attributes, blocked status, and display label.

Each pathway is treated as bidirectional by the routing algorithm. Blocked pathways are excluded from the routing graph. Preference weights favor ramps and elevators; `avoidStairs` removes stair edges entirely.

## Functional scope

The app has student sign-in and account creation, an illustrated interactive campus map, searchable place list, saved destinations, start/destination controls, stair/ramp/elevator preferences, route summary and waypoint list, service status, pathway notices, and an administration panel for location and pathway CRUD. Student passwords are salted and hashed by the location service. The map geometry and starter campus are illustrative and should be replaced with verified campus survey data before operational use.

## API and test evidence

Endpoint details and example route payload are in the root `README.md`. Import `docs/AccessRoute.postman_collection.json` into Postman. The collection includes health checks, listing, route calculation, invalid-location handling, and a create/read/update/delete sequence that uses temporary records. Record screenshots or export a Postman run as submission evidence after running against the local stack or deployed services.

## Deployment

The three applications run independently through Docker Compose for a local demonstration. For cloud deployment, publish the location service, route service, and frontend as separate services; use MongoDB Atlas for persistence and set the environment variables described in the root README. Add actual service URLs here after deployment:

* Frontend: **Pending deployment**
* Campus Location Service: **Pending deployment**
* Route & Accessibility Service: **Pending deployment**

## Limitations and future work

The supplied map is a schematic, not a surveyed or georeferenced campus map. Walking time uses a simple estimate (75 meters per minute); there is no live indoor positioning, email verification, password reset, role-based authorization for campus administration, or cloud deployment configured in this workspace. Future work can include verified accessible route audits, user-reported closures, secure admin roles, live incident updates, geospatial map tiles, accessibility testing with disabled users, and more route preferences.

## Demonstration sequence

1. Start the stack and show the two service health endpoints and MongoDB-backed location list.
2. Choose North Gate to Central Library and calculate the stair-free route.
3. Toggle route preferences and compare the route result.
4. Show the temporarily closed South Connector and explain that it is excluded.
5. Open Manage campus, add or edit a test location and pathway, then remove the test records.
6. Show the Postman route request and explain how the route service retrieves the graph from the independent location service.
