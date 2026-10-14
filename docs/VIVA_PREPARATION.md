# AccessRoute viva preparation

## Short project pitch

“AccessRoute is a campus navigation app that considers accessibility preferences. A React client talks to two independent REST services: an Express service that owns campus locations and pathways in MongoDB, and a FastAPI route service that fetches the campus graph from the location service and uses Dijkstra's algorithm to find a suitable path. Users can avoid stairs, prefer ramps and elevators, and see distance, estimated time, and route steps. Campus staff can maintain locations and pathways, including closures.”

## Likely questions

**Why use microservices?**  The location data and routing logic are separate responsibilities with different deployment and scaling needs. Each exposes a REST API and can be run and deployed independently.

**How do the services communicate?**  The route service calls `GET /api/graph` on the location service for each calculation. It handles connection failures as HTTP 503 rather than returning a misleading route.

**How does Dijkstra's algorithm work here?**  Treat locations as graph vertices and pathways as weighted edges. Starting from the origin, repeatedly visit the lowest accumulated cost and relax neighboring edges until the destination is reached. Store each predecessor to reconstruct the waypoint sequence.

**How are accessibility preferences applied?**  Closed edges are always excluded. Stair edges are excluded when `avoidStairs` is true. Ramp and elevator preferences adjust edge weights to favor those features while still allowing a connected alternative.

**What is the database model?**  MongoDB stores locations and pathways in separate collections. Pathways hold the IDs of their endpoint locations and accessibility attributes used by the route planner.

**What if no accessible route exists?**  The route service returns a clear 404 response explaining no route matches the preferences. The client displays the service's message and lets the user change preferences or destination.

**How is CRUD demonstrated?**  The location service provides create, read, update, and delete operations for both locations and pathways. The admin panel uses those APIs. The Postman collection also includes a temporary-record CRUD flow.

**How would you deploy it?**  Deploy MongoDB Atlas, the location service, route service, and frontend independently. Configure the location service's Mongo URI and CORS origin, the route service's location-service URL and CORS origin, and the frontend's route and location API URLs.

**What are the current limitations?**  The campus map and data are illustrative. Time is estimated from a constant walking speed, and there is no indoor GPS, authentication, or production-grade authorization for administration. Real use requires surveyed routes, accessibility audits, security controls, and user testing.

**What would you improve next?**  Add secure staff roles, surveyed/geospatial paths, live closure reports, audit logs, automated API integration tests, accessibility testing with disabled campus members, and a map tile or indoor positioning integration.
