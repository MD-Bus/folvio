import { createRequestHandler } from "react-router"
import { handleApi } from "../app/server/api.server"
import { cleanup } from "../app/server/files.server"
import { purgeExpired } from "../app/server/collections.server"
import { withDashboardHeaders } from "../app/server/headers.server"
import { initRequestCache } from "../app/server/request-cache.server"
import { ensureMigrated, migrationFailureResponse, type Migration } from "../app/server/migrate.server"

// Migration files are bundled so the Worker can bring an older database up to date by itself.
const migrations: Migration[] = Object.entries(import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([path, sql]) => ({
  name: path.split("/").pop()!,
  sql,
}))

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
      /** Per-request CSP nonce for inline scripts. */
      nonce: string
    }
  }
}

const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Worker Previews (preview builds of pull requests) have no database: say so instead of reporting a failed upgrade.
    if (!env.DB) return previewWithoutDatabase(request)

    try {
      await ensureMigrated(env.DB, migrations)
    } catch (error) {
      return migrationFailureResponse(request, error)
    }

    // The REST API, also used by the dashboard and the recipient page for uploads and downloads.
    if (url.pathname.startsWith("/api/v1/") || url.pathname === "/api/v1") return withDashboardHeaders(await handleApi(request, env, ctx), request)

    // A share link asked for JSON (a program or an AI agent following the link) answers with the collection and how
    // to use it, instead of the page. Browsers ask for text/html first.
    const share = url.pathname.match(/^\/s\/([a-f0-9]{64})\/?$/)
    const accept = request.headers.get("accept") ?? ""
    if (share && request.method === "GET" && /application\/json/.test(accept) && !/text\/html/.test(accept)) {
      const api = new Request(new URL(`/api/v1/share/${share[1]}`, url), request)
      return withDashboardHeaders(await handleApi(api, env, ctx), request)
    }

    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    // A per-request copy of env: it is the key of the request-scoped cache (see request-cache.server.ts).
    const requestEnv = { ...env } as Env
    initRequestCache(requestEnv, request)
    const response = await requestHandler(request, { cloudflare: { env: requestEnv, ctx, nonce } })
    const out = withDashboardHeaders(response, request)
    // Programs that fetched the page of a link find its API here.
    if (share) out.headers.set("Link", `</api/v1/share/${share[1]}>; rel="alternate"; type="application/json"`)
    return out
  },

  // Every hour (wrangler.jsonc): abandoned uploads are aborted and their reserved space released, and expired
  // collections set to delete themselves are deleted.
  async scheduled(_controller, env, ctx) {
    await ensureMigrated(env.DB, migrations)
    ctx.waitUntil(cleanup(env).catch((error) => console.error("Folvio clean-up failed:", error)))
    // Collections set to delete themselves at their expiry date.
    ctx.waitUntil(purgeExpired(env).catch((error) => console.error("Folvio expiry deletion failed:", error)))
  },
} satisfies ExportedHandler<Env>

function previewWithoutDatabase(request: Request): Response {
  if (new URL(request.url).pathname.startsWith("/api/")) {
    return Response.json({ error: "This Worker has no D1 database bound (DB). Previews of pull requests run without one." }, { status: 503 })
  }
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview without a database</title>
<body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:0 20px;line-height:1.5">
<h1>Preview without a database</h1>
<p>This build of Folvio runs without a database: Cloudflare does not give previews of pull requests access to the production database, by design.
The build itself succeeded; merge the pull request to deploy it.</p>
<p>If this is not a preview, bind a D1 database as <code>DB</code> and an R2 bucket as <code>FILES</code> in the Worker's settings.</p>
</body>`
  return new Response(page, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}
