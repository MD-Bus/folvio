# Architecture and costs

Reviewed against Cloudflare documentation on 2026-11-04. Allowances are account-wide and can change.

| Service | Free allowance / constraint | Folvio use |
|---|---|---|
| Workers Free | 100,000 requests/day, 10 ms CPU per invocation, 128 MB memory, 50 subrequests | Small JSON authorization and metadata operations; static frontend assets; one hourly cron |
| D1 Free | 5 million rows read/day, 100,000 rows written/day, 5 GB account storage; 500 MB maximum per database | Indexed metadata, sessions and keys; no binary data |
| R2 Standard | 10 GB-month storage, 1 million Class A and 10 million Class B operations/month; free Internet egress | Private file objects and multipart parts |

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Workers/D1 free limits can stop requests when exhausted. R2 is metered beyond its allowance; its free allowance is **not a billing cap**. Standard storage is required: Infrequent Access has different fees and no equivalent free allowance. Billing activation/payment details can be required for R2. A paid Workers subscription, Queues, Durable Objects, external authentication or email service is not needed.

## Upload safety and quota accounting

The browser uploads through Folvio's Worker using its native R2 binding. JSON bodies are limited to 32 KB, while binary multipart bodies are limited to 16 MiB. Each binary request is streamed directly to R2 without calling arrayBuffer(), text() or formData() on file contents. Parts stay below Cloudflare Free's 100 MB request-body limit. Files up to 2 GB are split into sequential parts; upload reservations last one hour.

A single SQLite INSERT…SELECT atomically checks collection and installation usage before reserving bytes. Pending uploads count toward quota. Each part request authenticates the caller and checks ownership, folder permissions, expiration, part number and exact Content-Length. R2 consumes the fixed-length HTTP stream; completion verifies the final stored size. Permission revocation blocks subsequent parts and completion. In-flight requests may already be transferring.

Hourly cleanup handles at most five expired uploads per invocation, after a ten-minute grace period, plus bounded expired authentication records. The deployment script adds a one-day abort-incomplete-multipart lifecycle fallback. Downloads stream from R2 through an authenticated administrator endpoint. No S3 credentials, public bucket, or cross-origin browser upload setup is required.

See [R2 Workers multipart API](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/) and [lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## Practical capacity

Defaults: 8 GB installation quota, 1 GB per collection, 100 MB per file, 200 folders per collection, fewer than 20 hierarchy levels. Empty files are rejected. File and collection lists use 50-record cursor pages with a 51st lookahead record. Folder trees are bounded to 200 entries. Quota totals use indexed metadata scans; this design targets modest collections rather than millions of file records. No content transforms, virus scans, ZIP generation, server-side rendering or per-file background polling run inside Workers.

An 8 GB application quota leaves some room under R2's allowance, but other buckets, multipart retention, and account-wide usage may consume that room. Lower STORAGE_LIMIT_BYTES when sharing an account. Authenticated retries consume Worker requests and R2 operations even though stored bytes remain bounded. There is no absolute R2 spending guarantee.

Monitor Workers requests/CPU/errors, D1 rows read/written/storage, and R2 storage/Class A/Class B metrics in Cloudflare. Set available usage/billing notifications. Use a dedicated private bucket, short expiration dates and collection passwords for sensitive links. Delete collected files when no longer needed. Revoke unused API keys. Avoid public distribution of collection links and avoid unauthenticated third-party hotlinking. Stop uploads by setting collection upload permission off (also deny any folder overrides). Folder-specific links can be revoked independently.

## Security boundaries

One administrator per installation. API keys grant full admin access and are stored only as hashes. Cookies are HttpOnly, SameSite=Strict and Secure on HTTPS. Recipient identity is a signed random browser cookie tied to the collection password; changing that password invalidates recipient access cookies. Losing a cookie loses own-folder rename rights and the recipient's file listing; the administrator retains access. Recipient cookies last seven days; collection expiration is checked on every request.

Collection passwords use a server-secret HMAC, avoiding expensive password derivation in the 10 ms CPU budget. Protect the session secret and use strong collection passwords. Login/unlock attempts have a D1-backed fixed-window limit. D1 and R2 are not transactionally coupled; interrupted uploads retain reservations and are cleaned later. Files download as authenticated attachments. Admin-only previews support small raster formats with explicit image types; HTML and SVG are not previewed. No antivirus scanning is performed.

A real 105 MiB transfer through the Worker has passed staging verification. CPU measurements and validation scope are recorded in ACCEPTANCE.md; a small sample does not guarantee capacity for arbitrary traffic.

## File management and directory links

The administrator can rename and move completed files without rewriting their object contents. Grid/list views, previews, search of loaded pages and selected-file operations use the same authenticated API. Selected-file operations run sequentially to keep requests bounded. Folder-specific links have their own random tokens and are restricted server-side to that directory tree. The parent collection token is never returned to a scoped recipient.
