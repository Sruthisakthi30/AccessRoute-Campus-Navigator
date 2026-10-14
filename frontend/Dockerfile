FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_ROUTE_API_URL=http://localhost:8000
ARG VITE_LOCATION_API_URL=http://localhost:4001
ENV VITE_ROUTE_API_URL=$VITE_ROUTE_API_URL VITE_LOCATION_API_URL=$VITE_LOCATION_API_URL
RUN npm run build
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
