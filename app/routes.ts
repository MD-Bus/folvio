import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // The page recipients open from a shared link (no dashboard login).
  route("s/:token", "routes/share.tsx"),
  // Resource route of the dashboard's search dialog (JSON).
  route("search", "routes/search.tsx"),
  layout("routes/app.tsx", [
    route("overview", "routes/overview.tsx"),
    route("collections", "routes/collections.tsx"),
    route("collections/new", "routes/collections.new.tsx"),
    route("collections/:id", "routes/collections.$id.tsx"),
    route("api-keys", "routes/api-keys.tsx"),
  ]),
] satisfies RouteConfig
