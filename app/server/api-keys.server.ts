import { all, newRowId, run } from "./db.server"
import { randomHex, sha256Hex } from "./util.server"

export type ApiKeyRow = { id: string; name: string; prefix: string; created: number; last_used: number | null }

export async function listApiKeys(env: Env): Promise<ApiKeyRow[]> {
  return all<ApiKeyRow>(env, "SELECT id, name, prefix, created, last_used FROM api_keys ORDER BY created DESC LIMIT 100")
}

/** Creates a key. The secret is returned once; only its SHA-256 is stored. */
export async function createApiKey(env: Env, name: string): Promise<{ id: string; secret: string }> {
  const secret = `fv_${randomHex()}`
  const id = newRowId()
  await run(env, "INSERT INTO api_keys (id, name, hash, created, prefix) VALUES (?, ?, ?, ?, ?)", id, name, await sha256Hex(secret), Date.now(), secret.slice(0, 10))
  return { id, secret }
}

export async function revokeApiKey(env: Env, id: string): Promise<void> {
  await run(env, "DELETE FROM api_keys WHERE id = ?", id)
}

/** True for a valid key. Remembers when it was last used (at most once a minute, to save writes). */
export async function verifyApiKey(env: Env, secret: string, ctx?: ExecutionContext): Promise<boolean> {
  if (!/^fv_[a-f0-9]{64}$/.test(secret)) return false
  const hash = await sha256Hex(secret)
  const row = await env.DB.prepare("SELECT id, last_used FROM api_keys WHERE hash = ?").bind(hash).first<{ id: string; last_used: number | null }>()
  if (!row) return false
  const now = Date.now()
  if (!row.last_used || now - row.last_used > 60_000) {
    const touch = run(env, "UPDATE api_keys SET last_used = ? WHERE id = ?", now, row.id).catch(() => {})
    if (ctx) ctx.waitUntil(touch)
    else await touch
  }
  return true
}
