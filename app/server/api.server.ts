import { PART_SIZE } from "#/lib/format"
import { getSession, throttle } from "./auth.server"
import { verifyApiKey } from "./api-keys.server"
import {
  authorize,
  collectionSummary,
  createCollection,
  createFolder,
  deleteCollection,
  deleteFolder,
  pageCollections,
  permissionsAt,
  regenerateToken,
  updateCollection,
  updateFolder,
  visibleFolders,
  type Access,
} from "./collections.server"
import { abortUpload, archiveManifest, completeUpload, deleteFiles, findFolderParam, getFile, initUpload, listFiles, SINGLE_UPLOAD_MAX, streamFile, updateFiles, uploadPart, uploadWhole } from "./files.server"
import { adminAccess, apiRecipientAccess, createLink, findShare, listLinks, openShare, RECIPIENT_HEADER, revokeLink } from "./share.server"
import { folderPath } from "#/lib/folders"
import { fail, HttpError } from "./util.server"

const JSON_LIMIT = 32_000

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } })
}

/** Reads a JSON object body of at most 32 KB without trusting Content-Length. */
async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader()
  let text = ""
  let total = 0
  const decoder = new TextDecoder()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > JSON_LIMIT) {
        await reader.cancel()
        fail(413, "The request is too large.")
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  }
  if (!text.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail(400, "Invalid JSON.")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected a JSON object.")
  return value as Record<string, unknown>
}

/** The administrator, by API key (`Authorization: Bearer fv_...`) or by the dashboard's login cookie. */
async function isAdmin(request: Request, env: Env, ctx: ExecutionContext): Promise<boolean> {
  const auth = request.headers.get("authorization")
  if (auth?.startsWith("Bearer ")) return verifyApiKey(env, auth.slice(7).trim(), ctx)
  return Boolean(await getSession(request, env))
}

function serializeCollection(access: Access, base: string) {
  const { password, folder_root, revision, ...c } = access.c
  const folders = visibleFolders(access)
  const root = folder_root ? access.folders.find((f) => f.id === folder_root) : null
  return {
    ...c,
    name: root && !access.admin ? root.name : c.name,
    collection_name: c.name,
    upload: !!c.upload,
    create_folder: !!c.create_folder,
    rename_own: !!c.rename_own,
    show_files: !!c.show_files,
    token: access.admin ? c.token : undefined,
    password_set: !!password,
    folders: folders.map((f) => ({ ...f, path: folderPath(folders, f.id, "/"), hidden: !!f.hidden, own: access.admin ? undefined : f.own })),
    permissions: permissionsAt(access, access.admin ? null : folder_root),
    api: apiGuide(base),
  }
}

/** How to use this collection from a program: returned with the collection so a link explains itself to an AI agent. */
function apiGuide(base: string) {
  return {
    base,
    upload: `PUT ${base}/upload/<file name>?folder=<folder path, e.g. Branding/Logos, or id; empty for the top> with the raw file as the body (curl -T report.pdf "${base}/upload/report.pdf?folder=Branding/Logos"). Up to ${SINGLE_UPLOAD_MAX.toLocaleString("en-GB")} bytes per request and max_file per file.`,
    large_files: `POST ${base}/uploads {"name","size","folder"} -> {id, parts, part_size}; PUT ${base}/uploads/<id>/parts/<n> with exactly part_size bytes (the last part is shorter) -> {partNumber, etag}; POST ${base}/uploads/<id>/complete {"parts":[{partNumber, etag}, ...]}`,
    list_files: `GET ${base}/files?folder=<path or id> lists the files you can see (yours, or all when show_files is true), newest first; &recursive=1 includes subfolders, ?after=<next> pages.`,
    download: `GET ${base}/files/<id>/download for a file you can see; /preview for an image.`,
    create_folder: `POST ${base}/folders {"name"} when permissions.create_folder is true: it is created at the top level.`,
    identity: `The first response carries an X-Folvio-Recipient header. Send it back on later requests to keep seeing the files you sent. Password-protected links: send X-Folvio-Password on the first request.`,
  }
}

/** Routes shared by the administrator (/collections/:id/...) and recipients (/share/:token/...). */
async function collectionRoutes(request: Request, env: Env, access: Access, rest: string[], url: URL, base: string): Promise<Response> {
  const method = request.method
  const [section, id, sub] = rest
  const folderParam = (value: unknown) => (typeof value === "string" ? findFolderParam(access, value) : undefined)

  if (!section && method === "GET") return json(serializeCollection(access, base))

  // The whole file in one request: PUT .../upload/<name>?folder=<path or id> (or ?name=).
  if (section === "upload" && (method === "PUT" || method === "POST")) {
    const name = id ?? url.searchParams.get("name") ?? ""
    if (!name) fail(400, "Put the file name in the address: PUT .../upload/<file name>?folder=<folder path>.")
    return json(await uploadWhole(env, access, { name, folder: findFolderParam(access, url.searchParams.get("folder")) }, request), 201)
  }

  // What a ZIP of a folder contains (the dashboard builds the archive in the browser, streaming each file).
  if (section === "archive" && method === "GET") return json(await archiveManifest(env, access, findFolderParam(access, url.searchParams.get("folder"))))

  if (section === "files") {
    if (!id && method === "GET") {
      const q = url.searchParams.get("q") ?? undefined
      const recursive = ["1", "true"].includes(url.searchParams.get("recursive") ?? "")
      const page = await listFiles(env, access, { folder: q ? null : findFolderParam(access, url.searchParams.get("folder")), q, recursive, after: url.searchParams.get("after"), limit: Number(url.searchParams.get("limit")) || undefined })
      return json(page)
    }
    if (id && !sub && method === "PATCH") {
      await getFile(env, access, id)
      await updateFiles(env, access, [id], await body(request))
      return json({ ok: true })
    }
    if (id && !sub && method === "DELETE") {
      if (!access.admin) fail(403, "Only the administrator can delete files.")
      await getFile(env, access, id)
      await deleteFiles(env, access, [id])
      return json({ ok: true })
    }
    if (id && !sub && method === "GET") {
      const file = await getFile(env, access, id)
      return json({ id: file.id, name: file.name, size: file.size, created: file.created, folder: file.folder })
    }
    // Recipients can open the files they may see: their own, or every file of the folders they can open when the
    // collection shows all files.
    if (id && (sub === "download" || sub === "preview") && method === "GET") return streamFile(env, await getFile(env, access, id), sub)
  }

  if (section === "folders") {
    if (!id && method === "POST") {
      const input = await body(request)
      return json({ id: await createFolder(env, access, { name: input.name, parent: folderParam(input.parent) }) }, 201)
    }
    if (id && method === "PATCH") {
      await updateFolder(env, access, id, await body(request))
      return json({ ok: true })
    }
    if (id && method === "DELETE") {
      await deleteFolder(env, access, id)
      return json({ ok: true })
    }
  }

  if (section === "uploads") {
    if (!id && method === "POST") {
      const input = await body(request)
      return json(await initUpload(env, access, { ...input, folder: folderParam(input.folder) ?? null }), 201)
    }
    if (id && sub === "parts" && rest[3] && method === "PUT") return json(await uploadPart(env, access, id, Number(rest[3]), request))
    if (id && sub === "complete" && method === "POST") return json(await completeUpload(env, access, id, await body(request)))
    if (id && !sub && method === "DELETE") return json(await abortUpload(env, access, id))
  }

  if (section === "links" && access.admin) {
    if (!id && method === "GET") return json({ links: await listLinks(env, access.c.id) })
    if (!id && method === "POST") return json(await createLink(env, access, (await body(request)).folder), 201)
    if (id && method === "DELETE") {
      await revokeLink(env, access.c.id, id)
      return json({ ok: true })
    }
  }

  fail(404, "Unknown endpoint.")
}

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const method = request.method
  const p = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean).map(decodeURIComponent)

  // Browsers send Origin on cross-site requests: refuse those that change something.
  const origin = request.headers.get("origin")
  if (method !== "GET" && method !== "HEAD" && origin && origin !== url.origin) fail(403, "Cross-origin request blocked.")

  const isPart = method === "PUT" && p.at(-2) === "parts"
  const isWhole = (method === "PUT" || method === "POST") && (p[2] === "upload" || p[2] === "upload/" || (p[0] === "collections" && p[2] === "upload"))
  const length = Number(request.headers.get("content-length") || 0)
  if (!isWhole && length > (isPart ? PART_SIZE : JSON_LIMIT)) fail(413, "The request is too large.")

  if (p[0] === "share" && p[1]) {
    const base = `${url.origin}/api/v1/share/${p[1]}`
    if (p[2] === "open" && method === "POST") {
      await throttle(request, env, "open", 30)
      const c = await findShare(env, p[1])
      if (!c) fail(404, "This link does not exist or was revoked.")
      const input = await body(request)
      const password = typeof input.password === "string" ? input.password : (request.headers.get("x-folvio-password") ?? "")
      const opened = await openShare(request, env, c, password)
      return json({ ok: true, recipient: opened.recipient }, 200, { "set-cookie": opened.cookie, [RECIPIENT_HEADER]: opened.recipient })
    }
    const { access, issued } = await apiRecipientAccess(request, env, p[1])
    const response = await collectionRoutes(request, env, access, p.slice(2), url, base)
    if (issued) response.headers.set(RECIPIENT_HEADER, issued)
    return response
  }

  if (!(await isAdmin(request, env, ctx))) fail(401, "Authentication required: send Authorization: Bearer <API key>.")

  if (p[0] === "collections") {
    if (!p[1] && method === "GET") {
      const rows = await pageCollections(env, url.searchParams.get("after") ?? "")
      return json({ collections: rows.slice(0, 50).map((c) => ({ ...c, protected: !!c.protected, upload: !!c.upload })), next: rows.length > 50 ? rows[49].id : null })
    }
    if (!p[1] && method === "POST") {
      const input = await body(request)
      const created = await createCollection(env, input, Array.isArray(input.folders) ? input.folders : [])
      return json({ ...created, url: `${url.origin}/s/${created.token}` }, 201)
    }
    if (p[1]) {
      const access = await adminAccess(env, p[1])
      if (!p[2] && method === "PATCH") {
        await updateCollection(env, access.c, await body(request))
        return json({ ok: true })
      }
      if (!p[2] && method === "DELETE") {
        await deleteCollection(env, access.c)
        return json({ ok: true })
      }
      if (p[2] === "token" && method === "POST") return json({ token: await regenerateToken(env, access.c) })
      if (p[2] === "summary" && method === "GET") return json(await collectionSummary(env, access.c.id))
      return collectionRoutes(request, env, access, p.slice(2), url, `${url.origin}/api/v1/collections/${access.c.id}`)
    }
  }
  fail(404, "Unknown endpoint.")
}

/** The REST API under /api/v1. Errors are `{ "error": "message" }` with a non-2xx status. */
export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  try {
    return await route(request, env, ctx, url)
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    if (error instanceof Response) return json({ error: (await error.text()) || "Request refused." }, error.status)
    const message = String(error instanceof Error ? error.message : error)
    if (message.includes("UNIQUE")) return json({ error: "A folder with that name already exists here." }, 409)
    console.error("Folvio API error:", error)
    return json({ error: "The request failed. Please try again." }, 500)
  }
}

export { authorize }
