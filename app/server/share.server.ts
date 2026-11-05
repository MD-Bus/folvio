import type { Access, CollectionRow, ReachedCollection } from "./collections.server"
import { getCollection, getFolders, hashCollectionPassword } from "./collections.server"
import { all, one, run } from "./db.server"
import { cookieHeader, readCookie, throttle } from "./auth.server"
import { fail, hmacHex, randomHex, safeEqual, serverSecret } from "./util.server"

/** A recipient's access lasts a week; the collection's expiry is checked on every request anyway. */
const RECIPIENT_MAX_AGE = 7 * 24 * 3600

/** The collection behind a public token: the collection's own link, or a folder link limited to one folder. */
export async function findShare(env: Env, token: string): Promise<ReachedCollection | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  return (
    (await one<ReachedCollection>(env, "SELECT *, NULL AS folder_root FROM collections WHERE token = ?", token)) ??
    (await one<ReachedCollection>(env, "SELECT c.*, l.folder AS folder_root FROM collections c JOIN folder_links l ON l.collection = c.id WHERE l.token = ?", token))
  )
}

const cookieName = (c: CollectionRow) => `fv_${c.id}`
/** Bound to the collection's password: changing the password signs every recipient out. */
const signature = (env: Env, c: CollectionRow, owner: string) => hmacHex(serverSecret(env), `${c.id}:${c.password ?? ""}:${owner}`)

/**
 * The recipient's id from their cookie, or null. The id is random and only identifies "the browser that uploaded
 * these files": a recipient sees their own uploads and can rename folders they created, nothing else.
 */
export async function recipientId(request: Request, env: Env, c: CollectionRow): Promise<string | null> {
  const value = readCookie(request, cookieName(c)) ?? request.headers.get(RECIPIENT_HEADER)?.trim()
  if (!value) return null
  const [id, sig] = value.split(".")
  if (!id || !sig || !/^[a-f0-9]{16,64}$/.test(id)) return null
  return safeEqual(sig, await signature(env, c, id)) ? id : null
}

export const isExpired = (c: CollectionRow) => c.expires !== null && c.expires < Date.now()

/**
 * Programs and AI agents use a link without cookies: they send the recipient id they were given in this header
 * (returned by `open` and by the first request), and a password-protected link's password in `X-Folvio-Password`.
 */
export const RECIPIENT_HEADER = "x-folvio-recipient"
export const PASSWORD_HEADER = "x-folvio-password"

/**
 * Checks the password (if any) and opens the collection, keeping an existing recipient id. Returns the Set-Cookie for
 * browsers and the same credential as `recipient` for programs (header X-Folvio-Recipient).
 */
export async function openShare(request: Request, env: Env, c: CollectionRow, password: string): Promise<{ cookie: string; owner: string; recipient: string }> {
  if (isExpired(c)) fail(410, "This collection has expired.")
  if (c.password && !safeEqual(c.password, await hashCollectionPassword(env, password))) fail(401, "The password is not correct.")
  const owner = (await recipientId(request, env, c)) ?? randomHex(16)
  const recipient = `${owner}.${await signature(env, c, owner)}`
  // Lax, not Strict: the link is usually opened from an e-mail, and the first page load must carry the cookie.
  return { owner, recipient, cookie: cookieHeader(request, cookieName(c), recipient, RECIPIENT_MAX_AGE) }
}

/**
 * Access for an API request through a link. Browsers carry the cookie; programs carry X-Folvio-Recipient. A request
 * with neither is opened on the spot (with X-Folvio-Password for a protected link), and `issued` is the new recipient
 * credential the program should send next time to keep seeing its own uploads.
 */
export async function apiRecipientAccess(request: Request, env: Env, token: string): Promise<{ access: Access; issued: string | null }> {
  const c = await findShare(env, token)
  if (!c) fail(404, "This link does not exist or was revoked.")
  if (isExpired(c)) fail(410, "This collection has expired.")
  let owner = await recipientId(request, env, c)
  let issued: string | null = null
  if (!owner) {
    const password = request.headers.get(PASSWORD_HEADER)
    if (c.password && password === null) fail(401, "This collection is password protected: send the password in the X-Folvio-Password header.")
    if (c.password) await throttle(request, env, "open", 30)
    const opened = await openShare(request, env, c, password ?? "")
    owner = opened.owner
    issued = opened.recipient
  }
  return { access: { c, folders: await getFolders(env, c.id), owner, admin: false }, issued }
}

/** The access of a recipient through `token`, or an HTTP error (404 unknown, 410 expired, 401 not opened yet). */
export async function recipientAccess(request: Request, env: Env, token: string): Promise<Access> {
  const c = await findShare(env, token)
  if (!c) fail(404, "This link does not exist or was revoked.")
  if (isExpired(c)) fail(410, "This collection has expired.")
  const owner = await recipientId(request, env, c)
  if (!owner) fail(401, "Open the collection first.")
  return { c, folders: await getFolders(env, c.id), owner, admin: false }
}

export async function adminAccess(env: Env, collectionId: string): Promise<Access> {
  const c = await getCollection(env, collectionId)
  if (!c) fail(404, "Collection not found.")
  return { c: { ...c, folder_root: null }, folders: await getFolders(env, c.id), owner: "admin", admin: true }
}

// ---- folder links ---------------------------------------------------------------------------------------------------

export type FolderLink = { token: string; folder: string; created: number }

export async function listLinks(env: Env, collectionId: string): Promise<FolderLink[]> {
  return all<FolderLink>(env, "SELECT token, folder, created FROM folder_links WHERE collection = ? ORDER BY created DESC LIMIT 200", collectionId)
}

/** A link that only opens `folder` and what is inside it. The collection's own link is never revealed through it. */
export async function createLink(env: Env, access: Access, folder: unknown): Promise<FolderLink> {
  if (typeof folder !== "string" || !access.folders.some((f) => f.id === folder)) fail(400, "Choose a folder.")
  const token = randomHex()
  const created = Date.now()
  await run(env, "INSERT INTO folder_links (token, collection, folder, created) VALUES (?, ?, ?, ?)", token, access.c.id, folder, created)
  return { token, folder, created }
}

export async function revokeLink(env: Env, collectionId: string, token: string): Promise<void> {
  await run(env, "DELETE FROM folder_links WHERE token = ? AND collection = ?", token, collectionId)
}
