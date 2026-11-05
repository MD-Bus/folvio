// Secrets are configured in the Cloudflare dashboard (or `wrangler secret put`),
// so `wrangler types` does not know about them unless they exist in .dev.vars.
interface Env {
  DB: D1Database
  FILES: R2Bucket
  ADMIN_USERNAME: string
  ADMIN_PASSWORD: string
  SESSION_SECRET?: string
  STORAGE_LIMIT_BYTES?: string
}
