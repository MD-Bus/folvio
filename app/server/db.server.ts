type Param = string | number | null

export const one = <T>(env: Env, sql: string, ...args: Param[]) => env.DB.prepare(sql).bind(...args).first<T>()
export const all = async <T>(env: Env, sql: string, ...args: Param[]) => (await env.DB.prepare(sql).bind(...args).all<T>()).results
export const run = (env: Env, sql: string, ...args: Param[]) => env.DB.prepare(sql).bind(...args).run()

/** 24 random hex characters: the id format of collections, folders and uploads since 0.1.0. */
export const newRowId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("")

export function storageLimit(env: Env): number {
  const n = Number(env.STORAGE_LIMIT_BYTES)
  return Number.isSafeInteger(n) && n > 0 ? n : 8_000_000_000
}
