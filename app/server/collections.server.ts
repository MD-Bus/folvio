import { effectivePermissions, FolderError, MAX_FOLDERS, validateDraft, type DraftFolder, type FolderRow } from "#/lib/folders"
import { all, newRowId, one, run, storageLimit } from "./db.server"
import { fail, hmacHex, randomHex, serverSecret } from "./util.server"

export type CollectionRow = {
  id: string
  token: string
  name: string
  description: string
  password: string | null
  expires: number | null
  quota: number
  max_file: number
  create_folder: number
  rename_own: number
  upload: number
  /** 1: recipients see every file in the folders they can open; 0: only the files they sent. */
  show_files: number
  /** 1: the collection and its files are deleted once `expires` has passed. */
  auto_delete: number
  created: number
  revision: number
}

/** A collection as reached through a link: `folder_root` is the folder a folder link is limited to (null: all). */
export type ReachedCollection = CollectionRow & { folder_root: string | null }

export const DEFAULTS = { description: "", expires: null as number | null, quota: 1_000_000_000, max_file: 100_000_000, upload: 1, create_folder: 0, rename_own: 0, show_files: 0, auto_delete: 0 }
export const MAX_FILE_BYTES = 2_000_000_000

export type Settings = Pick<CollectionRow, "name" | "description" | "expires" | "quota" | "max_file" | "upload" | "create_folder" | "rename_own" | "show_files" | "auto_delete">

function integer(value: unknown, min: number, max: number, what: string): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) fail(400, `${what} must be a whole number from ${min.toLocaleString("en-GB")} to ${max.toLocaleString("en-GB")}.`)
  return n
}

/**
 * Validates collection settings from the API or a dashboard form, on top of `base`. Omitted fields keep their value.
 * Sizes are bytes; `expires` is Unix milliseconds or null.
 */
export function parseSettings(env: Env, input: Record<string, unknown>, base: Partial<Settings>): Settings {
  const out = { ...DEFAULTS, ...base } as Settings
  if ("name" in input) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 180) fail(400, "Enter a collection name of 1-180 characters.")
    out.name = input.name.trim()
  }
  if (!out.name) fail(400, "Enter a collection name.")
  if ("description" in input) {
    if (typeof input.description !== "string" || input.description.length > 2000) fail(400, "The description is limited to 2,000 characters.")
    out.description = input.description.trim()
  }
  for (const key of ["upload", "create_folder", "rename_own", "show_files", "auto_delete"] as const) {
    if (key in input) {
      if (typeof input[key] !== "boolean") fail(400, "Permissions must be true or false.")
      out[key] = Number(input[key])
    }
  }
  if ("quota" in input) out.quota = integer(input.quota, 1, storageLimit(env), "The storage limit")
  if ("max_file" in input) out.max_file = integer(input.max_file, 1, MAX_FILE_BYTES, "The maximum file size")
  if ("expires" in input) out.expires = input.expires === null || input.expires === "" ? null : integer(input.expires, 1, 8_640_000_000_000_000, "The expiry")
  if (out.auto_delete && !out.expires) fail(400, "Set an expiry date to delete the collection automatically.")
  return out
}

/** Collection passwords are compared as HMACs with the server secret (cheap enough for the free plan's CPU limit). */
export const hashCollectionPassword = (env: Env, password: string) => hmacHex(serverSecret(env), password)

export async function getCollection(env: Env, id: string): Promise<CollectionRow | null> {
  return one<CollectionRow>(env, "SELECT * FROM collections WHERE id = ?", id)
}

export async function getFolders(env: Env, collectionId: string): Promise<FolderRow[]> {
  return all<FolderRow>(env, "SELECT * FROM folders WHERE collection = ?", collectionId)
}

export type CollectionSummary = Pick<CollectionRow, "id" | "token" | "name" | "description" | "expires" | "created" | "upload" | "quota" | "auto_delete"> & {
  protected: number
  files: number
  bytes: number
  folders: number
  last_upload: number | null
}

const SUMMARY = `SELECT c.id, c.token, c.name, c.description, c.expires, c.created, c.upload, c.quota, c.auto_delete, c.password IS NOT NULL AS protected,
  (SELECT count(*) FROM uploads u WHERE u.collection = c.id AND u.state = 'complete') AS files,
  (SELECT coalesce(sum(size), 0) FROM uploads u WHERE u.collection = c.id AND u.state = 'complete') AS bytes,
  (SELECT count(*) FROM folders f WHERE f.collection = c.id) AS folders,
  (SELECT max(created) FROM uploads u WHERE u.collection = c.id AND u.state = 'complete') AS last_upload
  FROM collections c`

export async function listCollections(env: Env, opts: { q?: string; limit?: number } = {}): Promise<CollectionSummary[]> {
  const q = opts.q?.trim()
  return q
    ? all<CollectionSummary>(env, `${SUMMARY} WHERE c.name LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' ORDER BY c.created DESC LIMIT ?`, like(q), like(q), opts.limit ?? 500)
    : all<CollectionSummary>(env, `${SUMMARY} ORDER BY c.created DESC LIMIT ?`, opts.limit ?? 500)
}

export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Cursor page for the API: ids in lexicographic order, 50 per page plus one look-ahead record. */
export async function pageCollections(env: Env, after: string): Promise<CollectionSummary[]> {
  return all<CollectionSummary>(env, `${SUMMARY} WHERE c.id > ? ORDER BY c.id LIMIT 51`, after)
}

export async function collectionSummary(env: Env, id: string): Promise<CollectionSummary | null> {
  return one<CollectionSummary>(env, `${SUMMARY} WHERE c.id = ?`, id)
}

/** Creates a collection with its planned folders in one transaction. */
export async function createCollection(env: Env, input: Record<string, unknown>, drafts: DraftFolder[] = []): Promise<{ id: string; token: string }> {
  const s = parseSettings(env, input, {})
  const folders = validateDraft(drafts)
  const id = newRowId()
  const token = randomHex()
  const password = typeof input.password === "string" && input.password ? await hashCollectionPassword(env, input.password) : null
  const ids = new Map(folders.map((f) => [f.id, newRowId()]))
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO collections (id, token, name, description, password, expires, quota, max_file, create_folder, rename_own, upload, show_files, auto_delete, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, token, s.name, s.description, password, s.expires, s.quota, s.max_file, s.create_folder, s.rename_own, s.upload, s.show_files, s.auto_delete, Date.now()),
    ...folders.map((f) =>
      env.DB.prepare("INSERT INTO folders (id, collection, parent, name, creator) VALUES (?, ?, ?, ?, 'admin')").bind(ids.get(f.id)!, id, f.parent ? ids.get(f.parent)! : null, f.name),
    ),
  ])
  return { id, token }
}

/** Saves settings. `password`: undefined keeps it, "" removes it, anything else replaces it. Fails if the collection changed meanwhile. */
export async function updateCollection(env: Env, c: CollectionRow, input: Record<string, unknown>): Promise<void> {
  const s = parseSettings(env, input, c)
  let password = c.password
  if ("password" in input) {
    if (typeof input.password !== "string") fail(400, "The password must be text.")
    password = input.password ? await hashCollectionPassword(env, input.password) : null
  }
  const updated = await run(
    env,
    "UPDATE collections SET name = ?, description = ?, password = ?, expires = ?, quota = ?, max_file = ?, create_folder = ?, rename_own = ?, upload = ?, show_files = ?, auto_delete = ? WHERE id = ? AND revision = ?",
    s.name,
    s.description,
    password,
    s.expires,
    s.quota,
    s.max_file,
    s.create_folder,
    s.rename_own,
    s.upload,
    s.show_files,
    s.auto_delete,
    c.id,
    c.revision,
  )
  if (!updated.meta.changes) fail(409, "The collection changed meanwhile. Refresh and try again.")
}

/** Replaces the public link of the collection: the old one stops working at once. Folder links are not affected. */
export async function regenerateToken(env: Env, c: CollectionRow): Promise<string> {
  const token = randomHex()
  await run(env, "UPDATE collections SET token = ? WHERE id = ?", token, c.id)
  return token
}

/** Stored objects deleted per step: one R2 call deletes up to 1,000 keys. */
const PURGE_BATCH = 1000

/**
 * Deletes up to PURGE_BATCH stored files of a collection (aborting uploads in progress) and returns whether files
 * remain. Bounded so one request or one clean-up run stays within the free plan's limits.
 */
async function purgeFiles(env: Env, collectionId: string): Promise<boolean> {
  const uploads = await all<{ id: string; object_key: string; multipart: string | null; state: string }>(env, "SELECT id, object_key, multipart, state FROM uploads WHERE collection = ? LIMIT ?", collectionId, PURGE_BATCH)
  if (uploads.length === 0) return false
  // At most 20 multipart aborts per step (each is a request); the hourly clean-up handles any left over.
  for (const up of uploads.filter((u) => u.state !== "complete" && u.multipart).slice(0, 20)) await env.FILES.resumeMultipartUpload(up.object_key, up.multipart!).abort().catch(() => {})
  await env.FILES.delete(uploads.map((u) => u.object_key))
  await env.DB.prepare("DELETE FROM uploads WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(uploads.map((u) => u.id))).run()
  return uploads.length === PURGE_BATCH
}

/** Deletes a collection: its stored files, pending uploads, links, folders and the collection itself. */
export async function deleteCollection(env: Env, c: Pick<CollectionRow, "id">): Promise<void> {
  // A large collection takes several batches; each batch is a handful of requests.
  for (let i = 0; i < 20 && (await purgeFiles(env, c.id)); i++) {}
  if (await one(env, "SELECT id FROM uploads WHERE collection = ? LIMIT 1", c.id)) fail(503, "The collection is very large: its files are still being deleted. Try again in a moment.")
  await env.DB.batch([
    env.DB.prepare("DELETE FROM folder_links WHERE collection = ?").bind(c.id),
    env.DB.prepare("DELETE FROM folders WHERE collection = ?").bind(c.id),
    env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(c.id),
  ])
}

/**
 * Hourly: collections set to delete themselves whose expiry has passed lose a batch of files per run; once empty,
 * the collection, its folders and links are deleted. Returns the number of collections fully deleted.
 */
export async function purgeExpired(env: Env, now = Date.now()): Promise<number> {
  const due = await all<{ id: string }>(env, "SELECT id FROM collections WHERE auto_delete = 1 AND expires IS NOT NULL AND expires < ? ORDER BY expires LIMIT 3", now)
  let deleted = 0
  for (const c of due) {
    if (await purgeFiles(env, c.id)) continue
    if (await one(env, "SELECT id FROM uploads WHERE collection = ? LIMIT 1", c.id)) continue
    await env.DB.batch([
      env.DB.prepare("DELETE FROM folder_links WHERE collection = ?").bind(c.id),
      env.DB.prepare("DELETE FROM folders WHERE collection = ?").bind(c.id),
      env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(c.id),
    ])
    deleted++
  }
  return deleted
}

// ---- folders --------------------------------------------------------------------------------------------------------

/** What a request may do in a collection: the administrator, or a recipient identified by `owner`. */
export type Access = { c: ReachedCollection; folders: FolderRow[]; owner: string; admin: boolean }

export function wrapFolderErrors<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof FolderError) fail(error.status, error.message)
    throw error
  }
}

export function permissionsAt(access: Access, folder: string | null) {
  return wrapFolderErrors(() => effectivePermissions(access.c, access.folders, folder))
}

function within(access: Access, folder: string | null): boolean {
  if (!access.c.folder_root) return true
  const seen = new Set<string>()
  let current = folder
  while (current && !seen.has(current)) {
    if (current === access.c.folder_root) return true
    seen.add(current)
    current = access.folders.find((f) => f.id === current)?.parent ?? null
  }
  return false
}

/** Throws unless the caller may do `action` in `folder`. The administrator may do anything anywhere. */
export function authorize(access: Access, folder: string | null, action: "upload" | "create_folder" | "rename_own" | "view") {
  const p = permissionsAt(access, folder)
  if (access.admin) return p
  if (!within(access, folder)) fail(403, "This link does not give access to that folder.")
  if (p.hidden) fail(404, "Folder not found.")
  if (action !== "view" && !p[action]) fail(403, "You do not have permission for this folder.")
  return p
}

/** True when the caller may see `folder`: the administrator always, a recipient inside the link's folder and not hidden. */
export function canSee(access: Access, folder: string | null): boolean {
  if (access.admin) return true
  if (!within(access, folder)) return false
  try {
    return !permissionsAt(access, folder).hidden
  } catch {
    return false
  }
}

/** True when the caller sees every file, not only their own uploads. */
export const seesAllFiles = (access: Access) => access.admin || !!access.c.show_files

/** Folders a recipient can see: inside the link's folder and not hidden. The administrator sees all. */
export function visibleFolders(access: Access) {
  return access.folders
    .filter((f) => access.admin || (within(access, f.id) && f.id !== access.c.folder_root && !permissionsAt(access, f.id).hidden))
    .map((f) => ({ id: f.id, parent: f.parent === access.c.folder_root && !access.admin ? null : f.parent, name: f.name, upload: f.upload, create_folder: f.create_folder, rename_own: f.rename_own, hidden: f.hidden, own: f.creator === access.owner, permissions: permissionsAt(access, f.id) }))
}

export type VisibleFolder = ReturnType<typeof visibleFolders>[number]

/** For a recipient on a folder link, the link's folder is their root: null means that folder. */
export const resolveFolder = (access: Access, folder: string | null | undefined) => (folder ? folder : access.admin ? null : access.c.folder_root)

export async function createFolder(env: Env, access: Access, input: { name?: unknown; parent?: unknown }): Promise<string> {
  const parent = resolveFolder(access, typeof input.parent === "string" ? input.parent : null)
  authorize(access, parent, "create_folder")
  const name = wrapFolderErrors(() => cleanFolderName(input.name))
  if (access.folders.length >= MAX_FOLDERS) fail(409, `A collection holds at most ${MAX_FOLDERS} folders.`)
  let depth = 0
  for (let f = parent; f; f = access.folders.find((x) => x.id === f)?.parent ?? null) if (++depth >= 19) fail(400, "Folders are nested too deeply.")
  if (access.folders.some((f) => f.parent === parent && f.name === name)) fail(409, "A folder with that name already exists here.")
  const id = newRowId()
  const inserted = await run(
    env,
    "INSERT INTO folders (id, collection, parent, name, creator) SELECT ?, ?, ?, ?, ? WHERE (SELECT revision FROM collections WHERE id = ?) = ? AND (SELECT count(*) FROM folders WHERE collection = ?) < ?",
    id,
    access.c.id,
    parent,
    name,
    access.owner,
    access.c.id,
    access.c.revision,
    access.c.id,
    MAX_FOLDERS,
  )
  if (!inserted.meta.changes) fail(409, "The collection changed meanwhile. Refresh and try again.")
  return id
}

function cleanFolderName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 180 || /[\x00-\x1f/\\]/.test(value)) throw new FolderError(400, "Enter a folder name of 1-180 characters without slashes.")
  return value.trim()
}

type FolderPatch = { name?: unknown; parent?: unknown; hidden?: unknown; upload?: unknown; create_folder?: unknown; rename_own?: unknown }

/** Renames, moves or changes the permissions of a folder. Recipients may only rename folders they created, when allowed. */
export async function updateFolder(env: Env, access: Access, folderId: string, patch: FolderPatch): Promise<void> {
  const f = access.folders.find((x) => x.id === folderId)
  if (!f) fail(404, "Folder not found.")
  if (!access.admin) {
    authorize(access, f.id, "rename_own")
    if (f.creator !== access.owner || Object.keys(patch).some((k) => k !== "name")) fail(403, "You can only rename folders you created.")
  }
  const parent = "parent" in patch ? (typeof patch.parent === "string" && patch.parent ? patch.parent : null) : f.parent
  if (parent) permissionsAt(access, parent)
  for (let cursor = parent; cursor; cursor = access.folders.find((x) => x.id === cursor)?.parent ?? null) {
    if (cursor === f.id) fail(400, "A folder cannot be moved into itself.")
  }
  const revised = access.folders.map((x) => (x.id === f.id ? { ...x, parent } : x))
  for (const x of revised) wrapFolderErrors(() => effectivePermissions(access.c, revised, x.id))
  const name = "name" in patch ? wrapFolderErrors(() => cleanFolderName(patch.name)) : f.name
  if (access.folders.some((x) => x.id !== f.id && x.parent === parent && x.name === name)) fail(409, "A folder with that name already exists there.")
  const next: Record<"upload" | "create_folder" | "rename_own" | "hidden", number | null> = { upload: f.upload, create_folder: f.create_folder, rename_own: f.rename_own, hidden: f.hidden }
  for (const key of ["upload", "create_folder", "rename_own", "hidden"] as const) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value !== null && typeof value !== "boolean") fail(400, "Permissions must be true, false or null (inherit).")
    next[key] = value === null ? (key === "hidden" ? 0 : null) : (Number(value) as 0 | 1)
  }
  // Competing moves and permission edits are serialised by checking the collection's revision.
  const result = await run(
    env,
    "UPDATE folders SET parent = ?, name = ?, upload = ?, create_folder = ?, rename_own = ?, hidden = ? WHERE id = ? AND (SELECT revision FROM collections WHERE id = ?) = ?",
    parent,
    name,
    next.upload,
    next.create_folder,
    next.rename_own,
    next.hidden,
    f.id,
    access.c.id,
    access.c.revision,
  )
  if (!result.meta.changes) fail(409, "The folders changed meanwhile. Refresh and try again.")
}

/** Deletes an empty folder (no subfolders, no files, no uploads in progress). Its folder links go with it. */
export async function deleteFolder(env: Env, access: Access, folderId: string): Promise<void> {
  if (!access.admin) fail(403, "Only the administrator can delete folders.")
  const f = access.folders.find((x) => x.id === folderId)
  if (!f) fail(404, "Folder not found.")
  if (access.folders.some((x) => x.parent === f.id) || (await one(env, "SELECT id FROM uploads WHERE folder = ? LIMIT 1", f.id))) fail(409, "Move or delete what is inside the folder first.")
  await env.DB.batch([env.DB.prepare("DELETE FROM folder_links WHERE folder = ?").bind(f.id), env.DB.prepare("DELETE FROM folders WHERE id = ?").bind(f.id)])
}

// ---- overview -------------------------------------------------------------------------------------------------------

export async function overviewStats(env: Env) {
  const row = await one<{ collections: number; open: number; files: number; bytes: number; pending: number; reserved: number; week: number }>(
    env,
    `SELECT (SELECT count(*) FROM collections) AS collections,
      (SELECT count(*) FROM collections WHERE upload = 1 AND (expires IS NULL OR expires > ?)) AS open,
      (SELECT count(*) FROM uploads WHERE state = 'complete') AS files,
      (SELECT coalesce(sum(size), 0) FROM uploads WHERE state = 'complete') AS bytes,
      (SELECT count(*) FROM uploads WHERE state != 'complete') AS pending,
      (SELECT coalesce(sum(size), 0) FROM uploads WHERE state != 'complete') AS reserved,
      (SELECT count(*) FROM uploads WHERE state = 'complete' AND created > ?) AS week`,
    Date.now(),
    Date.now() - 7 * 86_400_000,
  )
  return { ...row!, limit: storageLimit(env) }
}

/** Daily count and size of received files, oldest first. */
export async function dailyUploads(env: Env, days: number, now = Date.now()) {
  const start = Math.floor(now / 86_400_000) * 86_400_000 - (days - 1) * 86_400_000
  const rows = await all<{ day: number; files: number; bytes: number }>(
    env,
    "SELECT (created / 86400000) * 86400000 AS day, count(*) AS files, coalesce(sum(size), 0) AS bytes FROM uploads WHERE state = 'complete' AND created >= ? GROUP BY day",
    start,
  )
  const byDay = new Map(rows.map((r) => [r.day, r]))
  return Array.from({ length: days }, (_, i) => {
    const day = start + i * 86_400_000
    return { day, files: byDay.get(day)?.files ?? 0, bytes: byDay.get(day)?.bytes ?? 0 }
  })
}

export { effectivePermissions }
