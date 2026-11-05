# Acceptance results

## 0.2.0, verified on 2026-11-05

Run locally with Node 22, Chromium (Playwright) and the Cloudflare Workers runtime through the Cloudflare Vite plugin, with emulated D1 and R2. Not yet run on a real Cloudflare account.

### Passing checks

- `npm run typecheck`, `npm run build` and `npm test` (17 tests: ZIP writer checked with Python's zipfile, migrations, permissions, collections, folders, uploads, passwords, folder links, admin API, links used by programs, recursive listings and file visibility, auto-delete, clean-up), on SQLite with an R2 stand-in.
- The Cloudflare Workers Build of `main` passes (after naming `folvio-db` and `folvio-files` so leftovers of an earlier install are reused).
- The scheduled handler, triggered in the Workers runtime, deleted an expired auto-delete collection with its file and kept the others.
- `wrangler deploy --dry-run`: bindings `DB` and `FILES` without ids or names (provisioned on deploy), cron trigger, 348 KB gzipped.
- A fresh local database is created and migrated by the Worker on its first request (no `wrangler d1 migrations apply`), including the trigger statements of 0002.
- A 22-step browser run passed against both the development server and the production build (`vite preview`, real CSP with nonces), on a clean database each time:
  - login (wrong and right password); five-step wizard with a folder template; the review step;
  - admin uploads into nested folders, including a 40 MiB file sent in 3 parts; download returns the full 41,943,040 bytes;
  - rename, move, collection-wide search; hide a folder; deny uploads and allow subfolders on another; create and delete a folder;
  - folder link creation; the recipient page: hidden folder absent, admin files invisible, upload into a permitted folder, read-only folder refused (UI and API 403), subfolder creation where allowed, admin API refused (401);
  - folder link limited to its folder (siblings absent), upload through it;
  - password set: recipients signed out, wrong password refused, right password accepted;
  - API key created and used; invalid key refused (401); collections created through the API;
  - overview, collections list, ⌘K search, dark theme, phone width without horizontal scrolling; revoked folder link answers 404;
  - ZIP of the whole collection (15 entries, the 40 MiB file intact, nested and empty folders) and of one folder (paths relative to it), each opened and tested with Python's zipfile;
  - the root shows folder cards and the files of every subfolder ("This folder only" shows none); the recipient tour (Next, Back, finish; not shown again after a reload; Skip on another link); a recipient sees a loading preview of an image they sent; expiry with auto-delete saved and shown.
- Links used by programs, with `curl` against the production build: JSON manifest from `/s/<token>` with `Accept: application/json`; `Link` header on the HTML page; a 40 MiB file uploaded in one `PUT` into `Branding/Logos` by path; `X-Folvio-Recipient` issued once and accepted; another program sees none of those files; a missing file name is explained.

### Not yet verified

- A deploy to a real account with the Deploy button and with `npm run deploy` (automatic D1/R2 creation, secrets, first-request migrations on real D1).
- Real R2 behaviour: files above 100 MB, the hourly clean-up on a real cron, a lifecycle rule.
- Worker CPU time on the free plan under real traffic.
- A keyboard and screen-reader review.

## 0.1.0, verified on 2026-11-04

The 0.1.0 code (now replaced) passed real browser → Worker → R2 uploads up to 105 MiB on an isolated staging account, folder-link isolation, abandoned-upload clean-up on real D1/R2 and a CPU sample of p50 3.3 ms, p99 9.4 ms. The upload protocol of 0.2.0 keeps the same design (16 MiB parts streamed into the R2 binding, exact lengths, size check on completion).
