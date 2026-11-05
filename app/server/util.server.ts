const encoder = new TextEncoder()

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(input)))
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))
}

/** Constant-time comparison of two equal-purpose strings (hex digests). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"

export function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ""
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

/** Time-sortable id: 8 chars of base36 timestamp + random suffix. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, "0")
  return `${prefix}_${time}${randomString(12)}`
}

export function base64url(bytes: Uint8Array | string): string {
  const arr = typeof bytes === "string" ? encoder.encode(bytes) : bytes
  let s = ""
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function fromBase64url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)
  const bin = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function json(body: unknown, init: ResponseInit & { headers?: HeadersInit } = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(body), { ...init, headers })
}

export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "0.0.0.0"
}

/**
 * Secret used for signing cookies and hashing collection passwords. Falls back to the admin password, as in 0.1.0, so
 * collection passwords and recipient cookies made by 0.1.0 keep working. Changing it invalidates both.
 */
export function serverSecret(env: Env): string {
  return env.SESSION_SECRET || env.ADMIN_PASSWORD || ""
}

/** An error with an HTTP status and a message that is safe to show. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message)
}

/** Random hex string of `bytes` random bytes (64 characters for the default). */
export function randomHex(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("")
}
