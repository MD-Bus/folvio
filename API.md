# REST API

Base URL: `https://YOUR-WORKER/api`. JSON requests and responses. Errors have `{ "error": "message" }` with a non-2xx status. Admin calls use the login cookie or `Authorization: Bearer fv_…`. Create/revoke keys in the dashboard. Keys have full administrative authority. Browser mutation requests must be same-origin.

| Method | Path | Purpose |
|---|---|---|
| GET, POST, DELETE | `/session` | Session status, username/password login, logout |
| GET, POST | `/keys` | List keys; create with `{name}` (secret returned once) |
| DELETE | `/keys/:id` | Revoke key |
| GET, POST | `/collections` | Cursor list; create collection |
| GET, PATCH | `/collections/:id` | Read collection/tree; update settings |
| POST | `/collections/:id/folders` | Create `{name,parent:null\|folderId}` |
| PATCH | `/collections/:id/folders/:folder` | Rename, move, permission overrides |
| DELETE | `/collections/:id/folders/:folder` | Delete empty folder; nonempty returns 409 |
| GET | `/collections/:id/files?folder=ID&after=ID` | List files; omit folder for root |
| GET, PATCH, DELETE | `/collections/:id/files/:file` | Get authenticated download URL; rename/move with `{name,folder}`; delete |
| GET | `/collections/:id/files/:file?download=1` | Stream the attachment through the Worker; authentication required |
| GET | `/collections/:id/files/:file?preview=1` | Admin-only raster preview, up to 10 MB |
| GET, POST | `/collections/:id/links` | List folder links; create with `{folder}` |
| DELETE | `/collections/:id/links/:token` | Revoke a folder link |
| POST | `/collections/:id/uploads` | Reserve and initialize `{name,size,folder}` |
| POST | `/collections/:id/uploads/:upload/part` | Prepare `{part:1}`; returns same-origin `{url,size}` |
| PUT | `/collections/:id/uploads/:upload/part?part=1` | Stream binary part of exactly the expected Content-Length; returns `{partNumber,etag}` |
| POST | `/collections/:id/uploads/:upload/complete` | Verify `{parts:[{partNumber:1,etag:"…"}]}` |
| DELETE | `/collections/:id/uploads/:upload` | Abort pending upload |
| POST | `/share/:token/open` | Open with `{password:"…"}` or `{}`; sets recipient cookie |

Recipient endpoints use `/share/:token` instead of `/collections/:id`, with the cookie from `open`. Supported: GET collection/tree/files, permitted folder POST/PATCH, upload POST/part/complete/abort. Administrator file download/delete and collection settings are unavailable. Recipients can only list their own uploaded files.

Collection creation requires `name`. Optional: `description`, `password`, `expires` (Unix milliseconds or null), `quota`, `max_file` (bytes), `upload` (default true), `create_folder` (default false), `rename_own` (default false). PATCH preserves omitted fields; password `""` removes it. Changing settings leaves the public token unchanged.

Folder PATCH accepts `name`, `parent`, `hidden` (boolean), and `upload`, `create_folder`, `rename_own` (boolean or null to inherit). Hidden ancestors always win. Recipients may PATCH only `name`, only on their own folder and only when authorized. Admin calls bypass recipient permissions.

Lists return up to 51 records. Display the first 50; if there is a 51st, request the next page with `after` equal to record 50's ID. Ordering is lexicographic ID order. IDs are opaque, not chronological.

Upload flow: initialize → prepare each part → PUT the exact returned size to the **Folvio Worker URL**, retaining authentication → collect each JSON `{partNumber,etag}` → complete with consecutive ordered parts. Initialization returns `id`, `parts` and `part_size` (16 MiB). The Worker streams request bodies into its R2 binding. Browser Blob requests set Content-Length automatically; server clients must provide it. JSON requests are capped at 32 KB; binary requests at 16 MiB. Reservations expire in one hour. Every request checks current access; URLs alone grant no authority. Completion is idempotent after success. Cancel only pending uploads; delete completed files through the file endpoint.

Folder links use the same `/share/:token` routes and collection password/expiry. Their visible tree and permitted operations are restricted to the selected directory and descendants. Omitting a destination means the scoped directory. Responses do not disclose the collection-wide token. Revocation immediately prevents further link access. Administrators can create several independent links per folder and revoke them with DELETE.

Example:

```js
const response = await fetch(`${origin}/api/collections`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Harbor Studio', create_folder: false })
});
const { id, token } = await response.json();
// Public URL: `${origin}/s/${token}`
```
