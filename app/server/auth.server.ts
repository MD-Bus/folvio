import { redirect } from "react-router"
import { clientIp, fail, hmacHex, randomHex, safeEqual, serverSecret, sha256Hex } from "./util.server"
import { memo } from "./request-cache.server"

const COOKIE = "fv_session"
const MAX_AGE = 60 * 60 * 24 * 7

export function authConfigured(env: Env): boolean {
  return Boolean(env.ADMIN_USERNAME?.trim() && env.ADMIN_PASSWORD)
}

export async function checkCredentials(env: Env, username: string, password: string): Promise<boolean> {
  if (!authConfigured(env)) return false
  // Hash both sides so the comparison is constant-time and length-independent.
  const [u1, u2, p1, p2] = await Promise.all([sha256Hex(username), sha256Hex(env.ADMIN_USERNAME.trim()), sha256Hex(password), sha256Hex(env.ADMIN_PASSWORD)])
  const userOk = safeEqual(u1, u2)
  const passOk = safeEqual(p1, p2)
  return userOk && passOk
}

/** Fingerprint of the current credentials. Stored with each session so a password change logs everyone out. */
async function credentialFingerprint(env: Env): Promise<string> {
  return hmacHex(serverSecret(env), `cred:${env.ADMIN_USERNAME.trim()}:${env.ADMIN_PASSWORD}`)
}

const sessionId = (token: string) => sha256Hex(`session:${token}`)

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=")
    if (k === name) return rest.join("=")
  }
  return null
}

export function cookieHeader(request: Request, name: string, value: string, maxAge: number, sameSite: "Lax" | "Strict" = "Lax"): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : ""
  return `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`
}

/**
 * Creates a server-side session and returns the Set-Cookie value. The cookie is an opaque random token: it carries
 * no data, so it cannot be forged, inspected or used to guess the password.
 */
export async function createSession(env: Env, request: Request): Promise<string> {
  const token = randomHex()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (id, cred, expires) VALUES (?, ?, ?)").bind(await sessionId(token), await credentialFingerprint(env), now + MAX_AGE * 1000),
  ])
  return cookieHeader(request, COOKIE, token, MAX_AGE)
}

/** Deletes the session on the server (so a copied cookie stops working) and returns an expiring cookie. */
export async function destroySession(env: Env, request: Request): Promise<string> {
  const token = readCookie(request, COOKIE)
  if (token && /^[a-f0-9]{64}$/.test(token)) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sessionId(token)).run()
  return cookieHeader(request, COOKIE, "", 0)
}

export type Session = { username: string }

export function getSession(request: Request, env: Env): Promise<Session | null> {
  // Every loader of a page authenticates; do the database lookup once per request.
  return memo(env, "session", () => loadSession(request, env))
}

async function loadSession(request: Request, env: Env): Promise<Session | null> {
  if (!authConfigured(env)) return null
  const token = readCookie(request, COOKIE)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null
  const row = await env.DB.prepare("SELECT cred, expires FROM sessions WHERE id = ?").bind(await sessionId(token)).first<{ cred: string; expires: number }>()
  if (!row || row.expires < Date.now()) return null
  if (!safeEqual(row.cred, await credentialFingerprint(env))) return null
  return { username: env.ADMIN_USERNAME.trim() }
}

/** Blocks cross-site posts against cookie-authenticated actions (defence in depth on top of SameSite). */
export function assertSameOrigin(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return
  const origin = request.headers.get("origin")
  if (!origin) return
  let host = ""
  try {
    host = new URL(origin).host
  } catch {}
  if (host !== new URL(request.url).host) throw new Response("Cross-origin request blocked", { status: 403 })
}

export async function requireAuth(request: Request, env: Env): Promise<Session> {
  assertSameOrigin(request)
  const session = await getSession(request, env)
  if (!session) throw redirect("/login")
  return session
}

/** Non-blocking hints shown in the dashboard. */
export function securityWarnings(env: Env): string[] {
  const warnings: string[] = []
  if ((env.ADMIN_PASSWORD ?? "").length < 12) warnings.push("Your ADMIN_PASSWORD is shorter than 12 characters. Use a long random password.")
  if (!env.SESSION_SECRET) warnings.push("SESSION_SECRET is not set, so cookies and collection passwords are signed with a key derived from ADMIN_PASSWORD. Add a random 32+ character SESSION_SECRET (changing it later signs recipients out and resets collection passwords).")
  return warnings
}

// ---- throttling -----------------------------------------------------------------------------------------------------

const WINDOW_MS = 15 * 60 * 1000

/**
 * Counts an attempt for `scope` from the caller's address in a fixed 15-minute window and throws 429 past `max`.
 * Used for logins and for opening password-protected collections.
 */
export async function throttle(request: Request, env: Env, scope: string, max: number): Promise<void> {
  const id = await sha256Hex(`${scope}:${serverSecret(env)}:${clientIp(request)}`)
  const now = Date.now()
  const row = await env.DB.prepare(
    "INSERT INTO attempts (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN expires < ? THEN 1 ELSE count + 1 END, expires = CASE WHEN expires < ? THEN excluded.expires ELSE expires END RETURNING count",
  )
    .bind(id, now + WINDOW_MS, now, now)
    .first<{ count: number }>()
  if ((row?.count ?? 0) > max) fail(429, "Too many attempts. Try again in 15 minutes.")
}

/** Forgets the attempts of `scope` from the caller's address, after a successful login. */
export async function clearThrottle(request: Request, env: Env, scope: string): Promise<void> {
  await env.DB.prepare("DELETE FROM attempts WHERE id = ?").bind(await sha256Hex(`${scope}:${serverSecret(env)}:${clientIp(request)}`)).run()
}
