# Architecture and costs

Allowances reviewed against Cloudflare's documentation in November 2026. They are account-wide and can change.

## How it is built

One Cloudflare Worker serves everything, like [Warden](https://github.com/momardia54/Warden):

```text
request ─► workers/app.ts
            ├─ ensureMigrated(DB)        bundled migrations, applied on the first request of an isolate
            ├─ /api/v1/...               REST API: admin (API key or login cookie) and share links
            ├─ /s/<token> + Accept: json the link's JSON manifest (for programs and AI agents)
            └─ everything else           React Router 7 (SSR): dashboard, recipient page, login
scheduled (hourly) ─► cleanup(): abandoned uploads, expired sessions and throttling records
```

- **React Router 7 with server rendering** on Workers, Tailwind 4 and shadcn/ui. Pages load their data in loaders and change it in actions; the browser only calls the API to upload, download and page through files.
- **D1** holds collections, folders, upload records, sessions, throttling and API keys. **R2** holds file contents under `uploads/<collection>/<upload>`.
- **Automatic provisioning.** `wrangler.jsonc` has no `database_id` and no `bucket_name`: on deploy (CLI, Deploy button or connected repository) Wrangler creates `<worker-name>-db` and a bucket and keeps reusing them. The optional `DB_SUFFIX` build variable renames the database (`scripts/set-database-suffix.mjs` patches the generated config).
- **Self-migrating database.** Migrations are bundled into the Worker and applied on the first request, with Wrangler's `d1_migrations` bookkeeping, so dashboard installs (which never run `wrangler d1 migrations apply`) stay up to date and both ways stay compatible. Trigger bodies are kept whole when splitting statements.
- **Previews** of pull requests run without a database (Cloudflare never gives them production's) and show a notice.

## Uploads

```text
browser / program ──PUT 16 MiB part──► Worker ──uploadPart(stream)──► R2 multipart upload
                  ──PUT whole file (≤95 MB)──► Worker ──put(stream)──► R2 object
```

1. **Reserve.** One `INSERT … SELECT` checks the collection's quota and the installation's `STORAGE_LIMIT_BYTES`, counting uploads in progress, and records the reservation (one hour).
2. **Send.** Each part request is authenticated and checked again: link or key, folder permissions (revoking stops the next part), ownership of the reservation, expiry, part number and exact `Content-Length`. The fixed-length body is handed to R2 as a stream: file contents are never buffered in JavaScript.
3. **Complete.** The parts list is checked, R2 completes the object, and its stored size must equal the reserved size or everything is deleted.

Parts stay far below the 100 MB request body limit of the free plan. Files up to 2 GB (`max_file`) are supported. No S3 credentials, presigned URLs, public bucket or CORS rules are needed. Downloads stream from R2 through the Worker, for the administrator only.

The hourly clean-up aborts at most five expired reservations per run (ten minutes after expiry) and deletes expired sessions and throttling records in bounded batches. D1 and R2 do not share transactions, so an interrupted request can leave a reservation; the clean-up releases it. An R2 lifecycle rule aborting incomplete multipart uploads after a day is a good extra safety net.

## Free allowances

| Service | Free allowance | Folvio's use |
| --- | --- | --- |
| Workers Free | 100,000 requests/day, 10 ms CPU per request, 128 MB memory | Pages, JSON, one request per 16 MiB part; one cron trigger |
| D1 Free | 5M rows read/day, 100,000 rows written/day, 5 GB storage (500 MB per database) | Metadata only, indexed |
| R2 Standard | 10 GB-month, 1M Class A and 10M Class B operations/month, free egress | File contents; about one Class A operation per part |

R2's allowance is **not a spending cap**: storage or operations beyond it are billed, and R2 needs a payment method to be activated. Folvio's 8 GB default limit is an application limit; lower `STORAGE_LIMIT_BYTES` when the account has other buckets. Infrequent Access storage is not used (it has no equivalent free allowance).

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 multipart from Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/).

## Practical capacity

Defaults: 8 GB per installation, 1 GB per collection, 100 MB per file; 200 folders per collection, 20 levels. File lists page 100 at a time, newest first. Quota totals use indexed scans of upload records: the design targets modest collections (thousands of files), not millions. Nothing heavy runs in the Worker: no thumbnails, ZIP files, virus scans or transcoding. Image previews stream the original file (raster images up to 10 MB).

Monitor Workers requests and errors, D1 reads/writes and R2 storage and operations in the Cloudflare dashboard, and set billing notifications. Delete collections you no longer need: their files go with them.
