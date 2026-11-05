import type { Route } from "./+types/search"
import { requireAuth } from "~/server/auth.server"
import { like, listCollections } from "~/server/collections.server"
import { all } from "~/server/db.server"

/** Quick search for the dashboard's search dialog: collections and received files by name. Returns JSON. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100)
  if (!q) return { q, collections: [], files: [] }
  const [collections, files] = await Promise.all([
    listCollections(env, { q, limit: 6 }),
    all<{ id: string; name: string; collection: string; collection_name: string; folder: string | null; folder_name: string | null }>(
      env,
      "SELECT u.id, u.name, u.collection, c.name AS collection_name, u.folder, f.name AS folder_name FROM uploads u JOIN collections c ON c.id = u.collection LEFT JOIN folders f ON f.id = u.folder WHERE u.state = 'complete' AND u.name LIKE ? ESCAPE '\\' ORDER BY u.created DESC LIMIT 8",
      like(q),
    ),
  ])
  return { q, collections: collections.map((c) => ({ id: c.id, name: c.name, description: c.description })), files }
}
