# REST API

Base URL: `https://<your-worker>/api/v1`. JSON requests and responses. Errors are `{ "error": "message" }` with a non-2xx status. Requests that change something and carry a foreign `Origin` header are refused (403); server clients send no `Origin`.

There are two ways in:

| Who | Paths | Authentication |
| --- | --- | --- |
| The administrator | `/collections/...` | `Authorization: Bearer fv_...` (API key from the dashboard), or the dashboard's login cookie |
| Anyone with a share link: browsers, programs, AI agents | `/share/<token>/...` | The link's token in the path. Browsers keep a cookie; programs send `X-Folvio-Recipient`. Protected links: `X-Folvio-Password` |

API keys have full administrator access. Keep them on your server and create one per integration so you can revoke them separately.

## Share links (recipients, programs and AI agents)

`<token>` is the last part of a share link `https://<your-worker>/s/<token>`, either the collection's link or a folder link.

```bash
# The link itself answers JSON when asked: same as GET /api/v1/share/<token>
curl -H "Accept: application/json" https://<your-worker>/s/<token>
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/share/<token>` | Name, description, limits, `folders` (with `path`), `permissions` at the top, and `api`: plain-language instructions |
| PUT | `/share/<token>/upload/<file name>?folder=<path or id>` | Upload a whole file in one request (body: the raw bytes, with Content-Length; up to 95 MB and `max_file`) |
| POST | `/share/<token>/uploads` | Reserve a larger upload `{name, size, folder}` → `{id, parts, part_size}` |
| PUT | `/share/<token>/uploads/<id>/parts/<n>` | Send part `n` (exactly `part_size` bytes; the last one is shorter) → `{partNumber, etag}` |
| POST | `/share/<token>/uploads/<id>/complete` | `{parts: [{partNumber, etag}, ...]}` in order |
| DELETE | `/share/<token>/uploads/<id>` | Cancel an upload in progress |
| GET | `/share/<token>/files?folder=<path or id>` | The files *you* sent to that folder, newest first. `?q=` searches by name; `?after=<next>` pages |
| POST | `/share/<token>/folders` | `{name, parent: <path or id>}` where subfolder creation is allowed |
| PATCH | `/share/<token>/folders/<id>` | `{name}`: rename a folder you created, where allowed |
| POST | `/share/<token>/open` | `{password}`: open the link explicitly. Sets the browser cookie and returns `{recipient}` |

**Identity.** A recipient is "the browser or program that sent these files". The first request without credentials opens the link and returns an `X-Folvio-Recipient` header (also `recipient` from `open`). Send it back on later requests to keep seeing your uploads and renaming your folders. Without it, a program is a new recipient each time; uploads still work. Changing the collection's password invalidates every recipient credential.

**Passwords.** For a protected link send `X-Folvio-Password: <password>` with the first request (or `{password}` to `open`). Attempts are throttled per address (30 per 15 minutes).

**Folders** can be given by id or by path from the link's top, with `/` between names and case ignored: `Branding/Logos`. For a folder link, the top is that folder. Empty means the top. Unknown paths answer 404.

**Permissions** are those of a person with the link: hidden folders do not exist, closed folders refuse uploads (403), and nothing can be downloaded, moved or deleted.

```bash
# one-request upload, then list what this program sent
curl -sD headers.txt -T logo.svg "https://<your-worker>/api/v1/share/<token>/upload/logo.svg?folder=Branding/Logos"
RECIPIENT=$(grep -i x-folvio-recipient headers.txt | cut -d' ' -f2 | tr -d '\r')
curl -H "X-Folvio-Recipient: $RECIPIENT" "https://<your-worker>/api/v1/share/<token>/files?folder=Branding/Logos"
```

Large files from code:

```js
const base = `${origin}/api/v1/share/${token}`
const init = await (await fetch(`${base}/uploads`, { method: "POST", headers, body: JSON.stringify({ name: file.name, size: file.size, folder: "Images/Team photos" }) })).json()
const parts = []
for (let n = 1; n <= init.parts; n++) {
  const chunk = file.slice((n - 1) * init.part_size, n * init.part_size)
  parts.push(await (await fetch(`${base}/uploads/${init.id}/parts/${n}`, { method: "PUT", headers, body: chunk })).json())
}
await fetch(`${base}/uploads/${init.id}/complete`, { method: "POST", headers, body: JSON.stringify({ parts }) })
```

`headers` carries `X-Folvio-Recipient` (and `Content-Type: application/json` for the JSON calls). Reservations last one hour.

## Administrator

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/collections?after=<id>` | 50 collections per page with counts and sizes; `next` is the cursor of the next page |
| POST | `/collections` | Create. Returns `{id, token, url}` |
| GET | `/collections/<id>` | Settings, `token`, every folder with its overrides and effective `permissions` |
| PATCH | `/collections/<id>` | Change settings. Omitted fields keep their value |
| DELETE | `/collections/<id>` | Delete the collection, its stored files, folders and links |
| GET | `/collections/<id>/summary` | Files, bytes, folders, last upload |
| POST | `/collections/<id>/token` | Replace the collection link (the old one stops working; folder links keep working) |
| POST | `/collections/<id>/folders` | `{name, parent: <path or id, or null>}` |
| PATCH | `/collections/<id>/folders/<folder>` | `{name, parent, hidden, upload, create_folder, rename_own}`: `true`, `false` or `null` (inherit) |
| DELETE | `/collections/<id>/folders/<folder>` | Delete an empty folder (409 otherwise) and its folder links |
| GET | `/collections/<id>/files?folder=<path or id>&q=&after=` | All files in a folder (or matching `q` anywhere), newest first, with `uploader` |
| GET | `/collections/<id>/files/<file>` | One file's details |
| PATCH | `/collections/<id>/files/<file>` | `{name}` and/or `{folder}` (move) |
| DELETE | `/collections/<id>/files/<file>` | Delete the file and its stored contents |
| GET | `/collections/<id>/files/<file>/download` | Stream the file as an attachment |
| GET | `/collections/<id>/files/<file>/preview` | Raster image preview (PNG, JPEG, GIF, WebP, AVIF up to 10 MB) |
| GET, POST | `/collections/<id>/links` | List folder links; create one with `{folder}` |
| DELETE | `/collections/<id>/links/<token>` | Revoke a folder link |
| PUT, POST... | `/collections/<id>/upload/...`, `/collections/<id>/uploads/...` | The same upload endpoints as share links, as administrator |

### Collection fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | string | required | 1-180 characters |
| `description` | string | `""` | Up to 2,000 characters, shown to recipients |
| `password` | string | none | `""` removes it on PATCH. Stored as an HMAC |
| `expires` | Unix ms or `null` | `null` | After it, links answer 410 |
| `quota` | bytes | 1,000,000,000 | At most `STORAGE_LIMIT_BYTES` |
| `max_file` | bytes | 100,000,000 | At most 2,000,000,000 |
| `upload` | boolean | `true` | Recipients may upload |
| `create_folder` | boolean | `false` | Recipients may create subfolders |
| `rename_own` | boolean | `false` | Recipients may rename folders they created |
| `folders` | array | `[]` | POST only: `[{id, name, parent}]` with ids of your choice, parents referring to those ids |

Folder overrides inherit from the nearest folder above that sets them, then from the collection. A hidden folder hides everything below it, whatever the overrides say. Changes to folders are serialised: a request made against a collection that changed meanwhile answers 409; reload and retry.

## Limits

JSON bodies: 32 KB. Upload parts: 16 MiB (`part_size`). Whole-file uploads: 95 MB per request. Folders: 200 per collection, 20 levels. Lists: 100 files per page (up to 200 with `?limit=`), 50 collections per page. Status codes: 400 invalid input, 401 not authenticated or wrong password, 403 not allowed, 404 not found, 409 conflict, 410 expired, 411 missing Content-Length, 413 too large, 429 throttled, 507 storage limit reached.
