import { cleanName, FolderError } from "#/lib/folders"
import { IMAGE_TYPES, PART_SIZE, PREVIEW_MAX_BYTES } from "#/lib/format"
import { authorize, canSee, like, permissionsAt, resolveFolder, seesAllFiles, wrapFolderErrors, type Access } from "./collections.server"
import { all, newRowId, one, run, storageLimit } from "./db.server"
import { fail } from "./util.server"

export type FileRow = { id: string; collection: string; folder: string | null; owner: string; name: string; size: number; object_key: string; multipart: string | null; state: string; expires: number; created: number }
export type FileItem = { id: string; name: string; size: number; created: number; folder: string | null; uploader: "admin" | "recipient"; own: boolean }

export const PAGE = 100

/** The ids of `root` and every folder below it that the caller can see. */
function subtree(access: Access, root: string | null): string[] {
  const out: string[] = []
  const walk = (parent: string | null) => {
    for (const f of access.folders) {
      if (f.parent === parent && canSee(access, f.id)) {
        out.push(f.id)
        walk(f.id)
      }
    }
  }
  if (root) out.push(root)
  walk(root)
  return out
}

/**
 * Received files, newest first, `PAGE` at a time plus one look-ahead record. With `recursive`, the files of the folder
 * and of everything below it. A recipient sees the files they sent, or every file of the folders they can open when
 * the collection shows all files. With `q`, searches file names across everything the caller can see.
 * The cursor is `<created>_<id>` of the last file of the previous page.
 */
export async function listFiles(env: Env, access: Access, opts: { folder?: string | null; q?: string; after?: string | null; limit?: number; recursive?: boolean }): Promise<{ files: FileItem[]; next: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 200)
  const where = ["collection = ?", "state = 'complete'"]
  const args: (string | number | null)[] = [access.c.id]
  const q = opts.q?.trim()
  const folder = resolveFolder(access, opts.folder)
  if (q || opts.recursive) {
    const root = q ? resolveFolder(access, null) : folder
    authorize(access, root, "view")
    const ids = subtree(access, root)
    // One bound parameter (a JSON array), whatever the number of folders: D1 allows at most 100 per statement.
    where.push(root === null ? "(folder IS NULL OR folder IN (SELECT value FROM json_each(?)))" : "folder IN (SELECT value FROM json_each(?))")
    args.push(JSON.stringify(ids))
  } else {
    authorize(access, folder, "view")
    where.push("folder IS ?")
    args.push(folder)
  }
  if (q) {
    where.push("name LIKE ? ESCAPE '\\'")
    args.push(like(q))
  }
  if (!seesAllFiles(access)) {
    where.push("owner = ?")
    args.push(access.owner)
  }
  const cursor = opts.after?.match(/^(\d+)_([a-z0-9]+)$/)
  if (cursor) {
    where.push("(created < ? OR (created = ? AND id < ?))")
    args.push(Number(cursor[1]), Number(cursor[1]), cursor[2])
  }
  const rows = await all<FileRow>(env, `SELECT id, name, size, created, folder, owner FROM uploads WHERE ${where.join(" AND ")} ORDER BY created DESC, id DESC LIMIT ?`, ...args, limit + 1)
  const page = rows.slice(0, limit)
  return {
    files: page.map((r) => ({ id: r.id, name: r.name, size: r.size, created: r.created, folder: r.folder, uploader: r.owner === "admin" ? "admin" : "recipient", own: r.owner === access.owner })),
    next: rows.length > limit ? `${page.at(-1)!.created}_${page.at(-1)!.id}` : null,
  }
}

/**
 * Files per folder, counting what the caller can see (key "" is the root). `files` counts the folder itself,
 * `total` the folder and everything below it.
 */
export async function folderCounts(env: Env, access: Access): Promise<Record<string, { files: number; total: number; bytes: number }>> {
  const rows = seesAllFiles(access)
    ? await all<{ folder: string | null; files: number; bytes: number }>(env, "SELECT folder, count(*) AS files, coalesce(sum(size), 0) AS bytes FROM uploads WHERE collection = ? AND state = 'complete' GROUP BY folder", access.c.id)
    : await all<{ folder: string | null; files: number; bytes: number }>(env, "SELECT folder, count(*) AS files, coalesce(sum(size), 0) AS bytes FROM uploads WHERE collection = ? AND state = 'complete' AND owner = ? GROUP BY folder", access.c.id, access.owner)
  const direct = new Map(rows.map((r) => [r.folder ?? "", r]))
  const out: Record<string, { files: number; total: number; bytes: number }> = {}
  const visit = (id: string | null): { total: number; bytes: number } => {
    const key = id ?? ""
    const own = direct.get(key)
    let total = own?.files ?? 0
    let bytes = own?.bytes ?? 0
    for (const f of access.folders) {
      if (f.parent === id && canSee(access, f.id)) {
        const child = visit(f.id)
        total += child.total
        bytes += child.bytes
      }
    }
    out[key] = { files: own?.files ?? 0, total, bytes }
    return { total, bytes }
  }
  visit(null)
  return out
}

/** Largest archive the dashboard builds: plain ZIP (no ZIP64) holds 4 GiB and 65,535 entries. */
export const ARCHIVE_MAX_BYTES = 4_000_000_000
export const ARCHIVE_MAX_ENTRIES = 60_000

export type ArchiveEntry = { path: string; id?: string; size: number; created?: number }

/**
 * Everything a ZIP of `folder` (null: the whole collection) contains, for the browser to build it: each file with
 * its path inside the archive, and each folder (paths ending in "/") so empty folders are kept. Names that collide
 * within a folder get " (2)", " (3)"... Administrator only.
 */
export async function archiveManifest(env: Env, access: Access, folder: string | null): Promise<{ name: string; entries: ArchiveEntry[]; files: number; bytes: number }> {
  if (!access.admin) fail(403, "Only the administrator can download folders.")
  const root = folder ? access.folders.find((f) => f.id === folder) : null
  if (folder && !root) fail(404, "Folder not found.")
  const ids = subtree(access, folder)
  const rows = await all<{ id: string; name: string; size: number; folder: string | null; created: number }>(
    env,
    `SELECT id, name, size, folder, created FROM uploads WHERE collection = ? AND state = 'complete' AND ${folder === null ? "(folder IS NULL OR folder IN (SELECT value FROM json_each(?)))" : "folder IN (SELECT value FROM json_each(?))"} ORDER BY folder, name LIMIT ?`,
    access.c.id,
    JSON.stringify(ids),
    ARCHIVE_MAX_ENTRIES + 1,
  )
  const pathOf = (id: string | null): string => {
    const parts: string[] = []
    for (let f = id; f && f !== folder; f = access.folders.find((x) => x.id === f)?.parent ?? null) {
      parts.unshift(access.folders.find((x) => x.id === f)!.name)
    }
    return parts.length ? `${parts.join("/")}/` : ""
  }
  const entries: ArchiveEntry[] = ids.filter((id) => id !== folder).map((id) => ({ path: pathOf(id), size: 0 }))
  const taken = new Set(entries.map((e) => e.path.toLowerCase()))
  let bytes = 0
  for (const r of rows) {
    const dir = pathOf(r.folder)
    const dot = r.name.lastIndexOf(".")
    const [stem, ext] = dot > 0 ? [r.name.slice(0, dot), r.name.slice(dot)] : [r.name, ""]
    let path = `${dir}${r.name}`
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${dir}${stem} (${n})${ext}`
    taken.add(path.toLowerCase())
    entries.push({ path, id: r.id, size: r.size, created: r.created })
    bytes += r.size
  }
  if (entries.length > ARCHIVE_MAX_ENTRIES) fail(413, `This folder has more than ${ARCHIVE_MAX_ENTRIES.toLocaleString("en-GB")} files: download its subfolders separately.`)
  if (bytes > ARCHIVE_MAX_BYTES) fail(413, "This folder holds more than 4 GB: download its subfolders separately.")
  return { name: root?.name ?? access.c.name, entries, files: rows.length, bytes }
}

/** A received file the caller may see: the administrator any, a recipient their own or, with show_files, any in a visible folder. */
export async function getFile(env: Env, access: Access, id: string): Promise<FileRow> {
  const file = await one<FileRow>(env, "SELECT * FROM uploads WHERE id = ? AND collection = ? AND state = 'complete'", id, access.c.id)
  if (!file || !canSee(access, file.folder) || (!seesAllFiles(access) && file.owner !== access.owner)) fail(404, "File not found.")
  return file
}

/** Renames and/or moves files of the collection (administrator only). Contents are not rewritten. */
export async function updateFiles(env: Env, access: Access, ids: string[], patch: { name?: unknown; folder?: unknown }): Promise<number> {
  if (!access.admin) fail(403, "Only the administrator can change files.")
  if (ids.length === 0) return 0
  if (ids.length > 200) fail(400, "Change at most 200 files at once.")
  if ("name" in patch && ids.length !== 1) fail(400, "Rename one file at a time.")
  const name = "name" in patch ? wrapFolderErrors(() => cleanName(patch.name, "file name")) : null
  const folder = "folder" in patch ? (typeof patch.folder === "string" && patch.folder ? patch.folder : null) : undefined
  if (folder !== undefined) permissionsAt(access, folder)
  const statements = ids.map((id) => {
    const sets = [name !== null && "name = ?", folder !== undefined && "folder = ?"].filter(Boolean).join(", ")
    const values = [...(name !== null ? [name] : []), ...(folder !== undefined ? [folder] : [])]
    return env.DB.prepare(`UPDATE uploads SET ${sets} WHERE id = ? AND collection = ? AND state = 'complete'`).bind(...values, id, access.c.id)
  })
  if (!statements.length || (name === null && folder === undefined)) return 0
  const results = (await env.DB.batch(statements)) as D1Result[]
  return results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0)
}

/** Deletes received files and their stored contents (administrator only). */
export async function deleteFiles(env: Env, access: Access, ids: string[]): Promise<number> {
  if (!access.admin) fail(403, "Only the administrator can delete files.")
  if (ids.length > 200) fail(400, "Delete at most 200 files at once.")
  const unique = [...new Set(ids)]
  if (!unique.length) return 0
  const rows = await all<{ id: string; object_key: string }>(env, `SELECT id, object_key FROM uploads WHERE collection = ? AND state = 'complete' AND id IN (${unique.map(() => "?").join(",")})`, access.c.id, ...unique)
  if (!rows.length) return 0
  await env.FILES.delete(rows.map((r) => r.object_key))
  await env.DB.batch(rows.map((r) => env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(r.id)))
  return rows.length
}

/** Streams a stored file: as an attachment, or inline for an image preview (administrator only, raster images only). */
export async function streamFile(env: Env, file: FileRow, mode: "download" | "preview"): Promise<Response> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  const mime = Object.hasOwn(IMAGE_TYPES, ext) ? IMAGE_TYPES[ext] : null
  if (mode === "preview" && (!mime || file.size > PREVIEW_MAX_BYTES)) fail(400, "No preview for this file.")
  const object = await env.FILES.get(file.object_key)
  if (!object) fail(404, "The stored file is missing.")
  return new Response(object.body, {
    headers: {
      "Content-Type": mode === "preview" ? mime! : "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": `${mode === "preview" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  })
}

export async function recentFiles(env: Env, limit = 8) {
  return all<{ id: string; name: string; size: number; created: number; collection: string; collection_name: string; folder: string | null; folder_name: string | null; owner: string }>(
    env,
    `SELECT u.id, u.name, u.size, u.created, u.collection, c.name AS collection_name, u.folder, f.name AS folder_name, u.owner
     FROM uploads u JOIN collections c ON c.id = u.collection LEFT JOIN folders f ON f.id = u.folder
     WHERE u.state = 'complete' ORDER BY u.created DESC LIMIT ?`,
    limit,
  )
}

/** Count and size of the files in each folder of a collection (null key: the root). */
export async function folderUsage(env: Env, collectionId: string) {
  const rows = await all<{ folder: string | null; files: number; bytes: number }>(env, "SELECT folder, count(*) AS files, coalesce(sum(size), 0) AS bytes FROM uploads WHERE collection = ? AND state = 'complete' GROUP BY folder", collectionId)
  return Object.fromEntries(rows.map((r) => [r.folder ?? "", { files: r.files, bytes: r.bytes }])) as Record<string, { files: number; bytes: number }>
}

// ---- uploads --------------------------------------------------------------------------------------------------------
//
// The browser sends each file to the Worker in parts of PART_SIZE bytes, and the Worker streams each part straight into
// its R2 binding as one part of an R2 multipart upload. File contents are never buffered in JavaScript, no S3
// credentials or bucket CORS are needed, and each request stays far below the 100 MB request body limit.
//
// 1. POST   uploads                     {name, size, folder}  reserves the space and returns {id, parts, part_size}
// 2. PUT    uploads/<id>/parts/<n>      body: exactly the part's bytes; returns {partNumber, etag}
// 3. POST   uploads/<id>/complete       {parts: [{partNumber, etag}, ...]}
//    DELETE uploads/<id>                cancels a pending upload
//
// Every request checks the caller's access, the folder's permissions, the reservation's owner and its expiry (1 hour).

const RESERVATION_MS = 3_600_000

/**
 * A folder given by id, or by path of names from the caller's root ("Branding/Logos", case-insensitive), which is
 * easier for programs and AI agents. Empty means the root (for a folder link, the link's folder).
 */
export function findFolderParam(access: Access, value: string | null | undefined): string | null {
  const raw = (value ?? "").trim()
  if (!raw || raw === "/") return resolveFolder(access, null)
  if (access.folders.some((f) => f.id === raw)) return raw
  let current = resolveFolder(access, null)
  for (const part of raw.split("/").map((p) => p.trim()).filter(Boolean)) {
    const next = access.folders.find((f) => f.parent === current && f.name.toLowerCase() === part.toLowerCase())
    if (!next) fail(404, `Folder not found: ${raw}`)
    current = next.id
  }
  return current
}

/** Checks the target and the size, then reserves the space: one statement checks both quotas, pending uploads included. */
async function reserve(env: Env, access: Access, input: { name?: unknown; size?: unknown; folder?: unknown }) {
  const folder = resolveFolder(access, typeof input.folder === "string" ? input.folder : null)
  authorize(access, folder, "upload")
  if (!access.admin && access.c.expires && access.c.expires < Date.now()) fail(410, "This collection has expired.")
  const name = wrapFolderErrors(() => cleanName(input.name, "file name"))
  const size = input.size
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1) fail(400, "Empty files cannot be uploaded.")
  if (size > access.c.max_file) fail(413, `Files are limited to ${access.c.max_file.toLocaleString("en-GB")} bytes in this collection.`)
  const id = newRowId()
  const key = `uploads/${access.c.id}/${id}`
  const now = Date.now()
  // One statement checks the collection's and the installation's quota (pending uploads included) and reserves the space.
  const inserted = await run(
    env,
    "INSERT INTO uploads (id, collection, folder, owner, name, size, object_key, expires, created) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT coalesce(sum(size), 0) FROM uploads WHERE collection = ?) + ? <= ? AND (SELECT coalesce(sum(size), 0) FROM uploads) + ? <= ?",
    id,
    access.c.id,
    folder,
    access.owner,
    name,
    size,
    key,
    now + RESERVATION_MS,
    now,
    access.c.id,
    size,
    access.c.quota,
    size,
    storageLimit(env),
  )
  if (!inserted.meta.changes) fail(507, "Not enough storage left in this collection (uploads in progress count).")
  return { id, key, size, folder, name }
}

/** Requests up to this size can carry a whole file (the Workers free plan accepts request bodies up to 100 MB). */
export const SINGLE_UPLOAD_MAX = 95_000_000

/**
 * The whole file in one request, for programs and AI agents: `PUT .../upload/<name>?folder=Branding/Logos` with the
 * raw bytes as the body and a Content-Length. The body is streamed straight into R2. Larger files use the parts flow.
 */
export async function uploadWhole(env: Env, access: Access, input: { name: string; folder: string | null }, request: Request) {
  if (!request.headers.has("content-length")) fail(411, "Content-Length is required (curl -T sets it).")
  const size = Number(request.headers.get("content-length"))
  if (size > SINGLE_UPLOAD_MAX) fail(413, `Send files larger than ${SINGLE_UPLOAD_MAX.toLocaleString("en-GB")} bytes in parts (POST uploads, PUT parts, POST complete).`)
  if (!request.body) fail(400, "The request has no body.")
  const r = await reserve(env, access, { name: input.name, size, folder: input.folder ?? undefined })
  try {
    await env.FILES.put(r.key, request.body)
    const object = await env.FILES.head(r.key)
    if (!object || object.size !== r.size) fail(400, "The received size does not match Content-Length.")
    await run(env, "UPDATE uploads SET state = 'complete', created = ? WHERE id = ?", Date.now(), r.id)
  } catch (error) {
    await env.FILES.delete(r.key).catch(() => {})
    await run(env, "DELETE FROM uploads WHERE id = ?", r.id)
    throw error
  }
  return { id: r.id, name: r.name, size: r.size, folder: r.folder }
}

export async function initUpload(env: Env, access: Access, input: { name?: unknown; size?: unknown; folder?: unknown }) {
  const { id, key, size } = await reserve(env, access, input)
  try {
    const mp = await env.FILES.createMultipartUpload(key)
    await run(env, "UPDATE uploads SET multipart = ? WHERE id = ?", mp.uploadId, id)
  } catch (error) {
    await run(env, "DELETE FROM uploads WHERE id = ?", id)
    throw error
  }
  return { id, part_size: PART_SIZE, parts: Math.ceil(size / PART_SIZE) }
}

async function pendingUpload(env: Env, access: Access, id: string): Promise<FileRow> {
  const up = await one<FileRow>(env, "SELECT * FROM uploads WHERE id = ? AND collection = ?", id, access.c.id)
  if (!up || (!access.admin && up.owner !== access.owner)) fail(404, "Upload not found.")
  // Revoking permission stops the following parts and the completion.
  authorize(access, up.folder, "upload")
  return up
}

export async function uploadPart(env: Env, access: Access, id: string, partNumber: number, request: Request) {
  const up = await pendingUpload(env, access, id)
  if (up.state !== "pending") fail(409, "This upload is being completed.")
  if (up.expires < Date.now()) fail(410, "The upload took too long. Start it again.")
  const parts = Math.ceil(up.size / PART_SIZE)
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > parts) fail(400, `Part must be from 1 to ${parts}.`)
  const expected = Math.min(PART_SIZE, up.size - (partNumber - 1) * PART_SIZE)
  if (!request.headers.has("content-length")) fail(411, "Content-Length is required.")
  if (Number(request.headers.get("content-length")) !== expected || !request.body) fail(400, `Part ${partNumber} must be exactly ${expected} bytes.`)
  // The fixed-length body goes straight to R2: never buffered in JavaScript.
  const uploaded = await env.FILES.resumeMultipartUpload(up.object_key, up.multipart!).uploadPart(partNumber, request.body)
  return { partNumber: uploaded.partNumber, etag: uploaded.etag }
}

export async function completeUpload(env: Env, access: Access, id: string, input: { parts?: unknown }) {
  const up = await pendingUpload(env, access, id)
  if (up.state === "complete") return { ok: true, id: up.id }
  if (up.expires < Date.now()) fail(410, "The upload took too long. Start it again.")
  const count = Math.ceil(up.size / PART_SIZE)
  const parts = input.parts
  if (!Array.isArray(parts) || parts.length !== count || parts.some((p, i) => !p || p.partNumber !== i + 1 || typeof p.etag !== "string" || p.etag.length > 256)) fail(400, "Invalid list of parts.")
  const claimed = await run(env, "UPDATE uploads SET state = 'completing' WHERE id = ? AND state IN ('pending', 'completing')", up.id)
  if (!claimed.meta.changes) fail(409, "This upload can no longer be completed.")
  let object = await env.FILES.head(up.object_key)
  if (!object) {
    try {
      await env.FILES.resumeMultipartUpload(up.object_key, up.multipart!).complete(parts as R2UploadedPart[])
    } catch (error) {
      if (!(await env.FILES.head(up.object_key))) throw error
    }
    object = await env.FILES.head(up.object_key)
  }
  if (!object || object.size !== up.size) {
    await env.FILES.delete(up.object_key)
    await run(env, "DELETE FROM uploads WHERE id = ?", up.id)
    fail(400, "The uploaded size does not match the announced size.")
  }
  await run(env, "UPDATE uploads SET state = 'complete', created = ? WHERE id = ?", Date.now(), up.id)
  return { ok: true, id: up.id }
}

export async function abortUpload(env: Env, access: Access, id: string) {
  const up = await one<FileRow>(env, "SELECT * FROM uploads WHERE id = ? AND collection = ?", id, access.c.id)
  if (!up || (!access.admin && up.owner !== access.owner)) fail(404, "Upload not found.")
  if (up.state !== "pending") fail(409, "Only uploads in progress can be cancelled.")
  const claimed = await run(env, "UPDATE uploads SET state = 'cancelling' WHERE id = ? AND state = 'pending'", up.id)
  if (!claimed.meta.changes) fail(409, "The upload changed meanwhile.")
  if (up.multipart) await env.FILES.resumeMultipartUpload(up.object_key, up.multipart).abort().catch(() => {})
  await env.FILES.delete(up.object_key)
  await run(env, "DELETE FROM uploads WHERE id = ?", up.id)
  return { ok: true }
}

/**
 * Hourly housekeeping, bounded for the free plan: aborts up to 5 abandoned uploads (10 minutes after their reservation
 * expired) and releases their space, then deletes expired sessions and throttling records. An R2 lifecycle rule that
 * aborts incomplete multipart uploads after a day is a good fallback (see the README).
 */
export async function cleanup(env: Env, now = Date.now()): Promise<number> {
  const expired = await all<FileRow>(env, "SELECT * FROM uploads WHERE state != 'complete' AND expires < ? LIMIT 5", now - 600_000)
  let cleaned = 0
  for (const up of expired) {
    try {
      if (up.multipart) await env.FILES.resumeMultipartUpload(up.object_key, up.multipart).abort().catch(() => {})
      await env.FILES.delete(up.object_key)
      await run(env, "DELETE FROM uploads WHERE id = ? AND state != 'complete'", up.id)
      cleaned++
    } catch {
      // Keep the reservation and retry on the next run.
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires < ? LIMIT 200)").bind(now),
    env.DB.prepare("DELETE FROM attempts WHERE id IN (SELECT id FROM attempts WHERE expires < ? LIMIT 200)").bind(now),
  ])
  return cleaned
}

export { FolderError }
