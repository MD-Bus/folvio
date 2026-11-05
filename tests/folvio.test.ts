import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { makeBucket, makeCtx, makeDb } from "./helpers/d1.ts"
import { splitStatements } from "../app/server/migrate.server.ts"
import { effectivePermissions, validateDraft, type FolderRow } from "../app/lib/folders.ts"
import { PART_SIZE } from "../app/lib/format.ts"
import { createCollection, createFolder, deleteCollection, deleteFolder, purgeExpired, updateCollection, updateFolder } from "../app/server/collections.server.ts"
import { cleanup, completeUpload, deleteFiles, folderCounts, getFile, initUpload, listFiles, updateFiles, uploadPart } from "../app/server/files.server.ts"
import { adminAccess, createLink, openShare, recipientAccess } from "../app/server/share.server.ts"
import { handleApi } from "../app/server/api.server.ts"
import { createApiKey } from "../app/server/api-keys.server.ts"
import { HttpError } from "../app/server/util.server.ts"
import { VERSION } from "../app/lib/version.ts"

function makeEnv(extra: Partial<Env> = {}) {
  const { DB, raw } = makeDb()
  const { bucket, objects, uploads } = makeBucket()
  const env = { DB, FILES: bucket, ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "a-long-test-password", SESSION_SECRET: "s".repeat(40), STORAGE_LIMIT_BYTES: "8000000000", ...extra } as Env
  return { env, raw, objects, uploads }
}

const status = async (p: Promise<unknown>) => {
  try {
    await p
    return 200
  } catch (e) {
    if (e instanceof HttpError) return e.status
    throw e
  }
}

const partRequest = (bytes: Uint8Array) => new Request("https://x.test/", { method: "PUT", body: bytes, headers: { "content-length": String(bytes.byteLength) } })

test("version matches package.json", () => {
  assert.equal(VERSION, JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).version)
})

test("splitStatements keeps trigger bodies whole and drops PRAGMA foreign_keys", () => {
  const sql = readFileSync(join(import.meta.dirname, "..", "migrations", "0002_collection_revisions.sql"), "utf8")
  const statements = splitStatements(sql)
  assert.equal(statements.length, 5)
  assert.ok(statements.slice(1).every((s) => /^CREATE TRIGGER[\s\S]*END$/i.test(s)))
  const init = splitStatements(readFileSync(join(import.meta.dirname, "..", "migrations", "0001_init.sql"), "utf8"))
  assert.ok(!init.some((s) => /pragma/i.test(s)))
  assert.ok(readdirSync(join(import.meta.dirname, "..", "migrations")).length >= 4)
})

test("permissions inherit from the nearest override; hidden ancestors win", () => {
  const c = { upload: 1, create_folder: 0, rename_own: 0 }
  const f = (id: string, parent: string | null, o: Partial<FolderRow> = {}): FolderRow => ({ id, parent, collection: "c", name: id, creator: "admin", upload: null, create_folder: null, rename_own: null, hidden: 0, ...o })
  const folders = [f("a", null, { upload: 0, create_folder: 1 }), f("b", "a"), f("c", "b", { upload: 1 }), f("h", null, { hidden: 1 }), f("hc", "h", { upload: 1 })]
  assert.deepEqual(effectivePermissions(c, folders, "b"), { upload: false, create_folder: true, rename_own: false, hidden: false })
  assert.equal(effectivePermissions(c, folders, "c").upload, true)
  assert.equal(effectivePermissions(c, folders, "hc").hidden, true)
  assert.throws(() => effectivePermissions(c, [f("x", "y"), f("y", "x")], "x"))
})

test("validateDraft orders parents first and refuses duplicates and missing parents", () => {
  const ordered = validateDraft([{ id: "2", name: "Logos", parent: "1" }, { id: "1", name: "Branding", parent: null }])
  assert.deepEqual(ordered.map((d) => d.id), ["1", "2"])
  assert.throws(() => validateDraft([{ id: "1", name: "A", parent: null }, { id: "2", name: "a", parent: null }]))
  assert.throws(() => validateDraft([{ id: "1", name: "A", parent: "nope" }]))
  assert.throws(() => validateDraft([{ id: "1", name: "a/b", parent: null }]))
})

test("a collection is created with its folder tree in one go", async () => {
  const { env, raw } = makeEnv()
  const { id, token } = await createCollection(env, { name: "Harbor", password: "pw" }, [
    { id: "t1", name: "Branding", parent: null },
    { id: "t2", name: "Logos", parent: "t1" },
  ])
  assert.match(token, /^[a-f0-9]{64}$/)
  const rows = raw.prepare("SELECT name, parent FROM folders WHERE collection = ?").all(id) as { name: string; parent: string | null }[]
  assert.equal(rows.length, 2)
  const branding = raw.prepare("SELECT id FROM folders WHERE name = 'Branding'").get() as { id: string }
  assert.equal(rows.find((r) => r.name === "Logos")!.parent, branding.id)
  const c = raw.prepare("SELECT password, create_folder, upload FROM collections WHERE id = ?").get(id) as { password: string; create_folder: number; upload: number }
  assert.notEqual(c.password, "pw")
  assert.deepEqual([c.create_folder, c.upload], [0, 1])
  assert.equal(await status(createCollection(env, { name: "" })), 400)
  assert.equal(await status(createCollection(env, { name: "X", quota: 9e9 })), 400)
})

test("folder edits: no cycles, no duplicates, stale revisions are refused, only empty folders are deleted", async () => {
  const { env } = makeEnv()
  const { id } = await createCollection(env, { name: "C" }, [{ id: "a", name: "A", parent: null }, { id: "b", name: "B", parent: "a" }])
  let access = await adminAccess(env, id)
  const A = access.folders.find((f) => f.name === "A")!.id
  const B = access.folders.find((f) => f.name === "B")!.id
  assert.equal(await status(updateFolder(env, access, A, { parent: B })), 400)
  assert.equal(await status(createFolder(env, access, { name: "B", parent: A })), 409)
  const stale = access
  await createFolder(env, access, { name: "C", parent: null })
  assert.equal(await status(createFolder(env, stale, { name: "D", parent: null })), 409, "the revision changed")
  access = await adminAccess(env, id)
  assert.equal(await status(deleteFolder(env, access, A)), 409, "has a subfolder")
  await updateFolder(env, access, B, { parent: null, upload: false, hidden: true })
  access = await adminAccess(env, id)
  const b = access.folders.find((f) => f.id === B)!
  assert.deepEqual([b.parent, b.upload, b.hidden], [null, 0, 1])
  await deleteFolder(env, access, A)
  assert.equal((await adminAccess(env, id)).folders.some((f) => f.id === A), false)
})

test("uploads: quota reservation, exact part sizes, completion check, recipients only see their own files", async () => {
  const { env, objects } = makeEnv()
  const { id, token } = await createCollection(env, { name: "C", quota: 3 * PART_SIZE, max_file: 3 * PART_SIZE }, [{ id: "a", name: "Logos", parent: null }])
  const admin = await adminAccess(env, id)
  const logos = admin.folders[0].id

  // a recipient opens the link
  const c = admin.c
  const { cookie } = await openShare(new Request("https://x.test/"), env, c, "")
  const recipientRequest = new Request("https://x.test/", { headers: { cookie: cookie.split(";")[0] } })
  const recipient = await recipientAccess(recipientRequest, env, token)

  const size = PART_SIZE + 10
  const init = await initUpload(env, recipient, { name: "big.bin", size, folder: logos })
  assert.equal(init.parts, 2)
  // the space is reserved: a second file that would exceed the quota is refused
  assert.equal(await status(initUpload(env, recipient, { name: "more.bin", size: 2 * PART_SIZE, folder: logos })), 507)
  // part 1 must be exactly PART_SIZE bytes
  assert.equal(await status(uploadPart(env, recipient, init.id, 1, partRequest(new Uint8Array(5)))), 400)
  const p1 = await uploadPart(env, recipient, init.id, 1, partRequest(new Uint8Array(PART_SIZE)))
  const p2 = await uploadPart(env, recipient, init.id, 2, partRequest(new Uint8Array(10)))
  assert.equal(await status(completeUpload(env, recipient, init.id, { parts: [p2, p1] })), 400, "parts out of order")
  await completeUpload(env, recipient, init.id, { parts: [p1, p2] })
  assert.equal(objects.get(`uploads/${id}/${init.id}`)!.bytes.length, size)

  // the admin uploads too; the recipient lists only their own file
  const a = await initUpload(env, admin, { name: "admin.txt", size: 3, folder: logos })
  await completeUpload(env, admin, a.id, { parts: [await uploadPart(env, admin, a.id, 1, partRequest(new Uint8Array(3)))] })
  assert.deepEqual((await listFiles(env, recipient, { folder: logos })).files.map((f) => f.name), ["big.bin"])
  assert.equal((await listFiles(env, admin, { folder: logos })).files.length, 2)
  assert.equal((await listFiles(env, admin, { q: "ADMIN" })).files[0].name, "admin.txt")

  // recipients cannot change or delete files; the admin can
  assert.equal(await status(deleteFiles(env, recipient, [a.id])), 403)
  await updateFiles(env, admin, [a.id], { name: "renamed.txt", folder: null })
  assert.equal((await listFiles(env, admin, { folder: null })).files[0].name, "renamed.txt")
  assert.equal(await deleteFiles(env, admin, [a.id]), 1)
  assert.equal(objects.has(`uploads/${id}/${a.id}`), false)
})

test("permissions are enforced for recipients: closed and hidden folders, folder creation off by default", async () => {
  const { env } = makeEnv()
  const { id, token } = await createCollection(env, { name: "C" }, [{ id: "a", name: "Open", parent: null }, { id: "b", name: "Closed", parent: null }, { id: "h", name: "Hidden", parent: null }])
  let admin = await adminAccess(env, id)
  const [open, closed, hidden] = ["Open", "Closed", "Hidden"].map((n) => admin.folders.find((f) => f.name === n)!.id)
  await updateFolder(env, admin, closed, { upload: false })
  admin = await adminAccess(env, id)
  await updateFolder(env, admin, hidden, { hidden: true })
  const { cookie } = await openShare(new Request("https://x.test/"), env, admin.c, "")
  const req = new Request("https://x.test/", { headers: { cookie: cookie.split(";")[0] } })
  const r = await recipientAccess(req, env, token)
  assert.equal(await status(initUpload(env, r, { name: "a.txt", size: 1, folder: closed })), 403)
  assert.equal(await status(initUpload(env, r, { name: "a.txt", size: 1, folder: hidden })), 404)
  assert.equal(await status(initUpload(env, r, { name: "a.txt", size: 1, folder: open })), 200)
  assert.equal(await status(createFolder(env, r, { name: "Mine", parent: open })), 403, "off by default")
  assert.equal(await status(deleteFolder(env, r, open)), 403)
  assert.equal(await status(updateFolder(env, r, open, { name: "X" })), 403)
})

test("passwords: wrong password refused, a password change signs recipients out", async () => {
  const { env } = makeEnv()
  const { id, token } = await createCollection(env, { name: "C", password: "secret" })
  const c = (await adminAccess(env, id)).c
  assert.equal(await status(openShare(new Request("https://x.test/"), env, c, "nope")), 401)
  const { cookie } = await openShare(new Request("https://x.test/"), env, c, "secret")
  const req = new Request("https://x.test/", { headers: { cookie: cookie.split(";")[0] } })
  assert.equal(await status(recipientAccess(req, env, token)), 200)
  await updateCollection(env, c, { password: "changed" })
  assert.equal(await status(recipientAccess(req, env, token)), 401)
  await updateCollection(env, (await adminAccess(env, id)).c, { expires: Date.now() - 1000 })
  assert.equal(await status(recipientAccess(req, env, token)), 410)
})

test("folder links only reach their folder and never reveal the collection token", async () => {
  const { env } = makeEnv()
  const { ctx } = makeCtx()
  const { id, token } = await createCollection(env, { name: "C" }, [{ id: "a", name: "Images", parent: null }, { id: "b", name: "Photos", parent: "a" }, { id: "c", name: "Branding", parent: null }])
  const admin = await adminAccess(env, id)
  const images = admin.folders.find((f) => f.name === "Images")!.id
  const branding = admin.folders.find((f) => f.name === "Branding")!.id
  const link = await createLink(env, admin, images)
  const open = await handleApi(new Request(`https://x.test/api/v1/share/${link.token}/open`, { method: "POST", body: "{}" }), env, ctx)
  const cookie = open.headers.get("set-cookie")!.split(";")[0]
  const get = (path: string, init: RequestInit = {}) => handleApi(new Request(`https://x.test/api/v1/share/${link.token}${path}`, { ...init, headers: { cookie, ...(init.headers ?? {}) } }), env, ctx)
  const body = await (await get("")).json()
  assert.deepEqual(body.folders.map((f: { name: string }) => f.name), ["Photos"])
  assert.equal(JSON.stringify(body).includes(token), false)
  const sibling = await get("/uploads", { method: "POST", body: JSON.stringify({ name: "x.txt", size: 1, folder: branding }) })
  assert.equal(sibling.status, 403)
  const inside = await get("/uploads", { method: "POST", body: JSON.stringify({ name: "x.txt", size: 1 }) })
  assert.equal(inside.status, 201)
})

test("API: bearer keys, cross-origin refusal, JSON errors", async () => {
  const { env } = makeEnv()
  const { ctx, settle } = makeCtx()
  const { secret } = await createApiKey(env, "test")
  const call = (path: string, init: RequestInit = {}, key = secret) => handleApi(new Request(`https://x.test/api/v1${path}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) } }), env, ctx)
  assert.equal((await call("/collections", {}, "fv_" + "0".repeat(64))).status, 401)
  const created = await call("/collections", { method: "POST", body: JSON.stringify({ name: "Via API", folders: [{ id: "1", name: "Docs" }] }) })
  assert.equal(created.status, 201)
  const { id, url } = await created.json()
  assert.match(url, /\/s\/[a-f0-9]{64}$/)
  const list = await (await call("/collections")).json()
  assert.equal(list.collections[0].folders, 1)
  const one = await (await call(`/collections/${id}`)).json()
  assert.equal(one.folders[0].name, "Docs")
  assert.equal("password" in one, false)
  assert.equal((await call(`/collections/${id}`, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }), headers: { origin: "https://evil.test" } })).status, 403)
  const bad = await call(`/collections/${id}`, { method: "PATCH", body: "not json" })
  assert.deepEqual([bad.status, (await bad.json()).error], [400, "Invalid JSON."])
  assert.equal((await call(`/collections/${id}`, { method: "DELETE" })).status, 200)
  assert.equal((await call(`/collections/${id}`)).status, 404)
  await settle()
})

test("deleting a collection removes its stored files; cleanup aborts abandoned uploads", async () => {
  const { env, raw, objects } = makeEnv()
  const { id } = await createCollection(env, { name: "C" })
  const admin = await adminAccess(env, id)
  const done = await initUpload(env, admin, { name: "a.txt", size: 2 })
  await completeUpload(env, admin, done.id, { parts: [await uploadPart(env, admin, done.id, 1, partRequest(new Uint8Array(2)))] })
  const abandoned = await initUpload(env, admin, { name: "b.txt", size: 2 })
  raw.prepare("UPDATE uploads SET expires = ? WHERE id = ?").run(Date.now() - 3_600_000, abandoned.id)
  assert.equal(await cleanup(env), 1)
  assert.equal(raw.prepare("SELECT count(*) AS n FROM uploads").get()!.n, 1)
  await deleteCollection(env, await adminAccess(env, id).then((a) => a.c))
  assert.equal(objects.size, 0)
  assert.equal(raw.prepare("SELECT count(*) AS n FROM collections").get()!.n, 0)
})

test("a share link works for programs: manifest, one-request upload by folder path, recipient header, password header", async () => {
  const { env, objects } = makeEnv()
  const { ctx } = makeCtx()
  const { token } = await createCollection(env, { name: "Harbor" }, [{ id: "a", name: "Branding", parent: null }, { id: "b", name: "Logos", parent: "a" }])
  const api = (path: string, init: RequestInit = {}) => handleApi(new Request(`https://x.test/api/v1/share/${token}${path}`, init), env, ctx)

  const manifest = await api("")
  assert.equal(manifest.status, 200)
  const recipient = manifest.headers.get("x-folvio-recipient")!
  assert.match(recipient, /^[a-f0-9]+\.[a-f0-9]{64}$/)
  const m = await manifest.json()
  assert.deepEqual(m.folders.map((f: { path: string }) => f.path).sort(), ["Branding", "Branding/Logos"])
  assert.match(m.api.upload, /upload\/<file name>/)

  const bytes = new TextEncoder().encode("hello logo")
  const put = await api("/upload/logo.svg?folder=branding/logos", { method: "PUT", body: bytes, headers: { "content-length": String(bytes.byteLength), "x-folvio-recipient": recipient } })
  assert.equal(put.status, 201)
  const sent = await put.json()
  assert.equal(objects.get(`uploads/${(await adminAccess(env, (await findCollectionId(env, token)))).c.id}/${sent.id}`)!.bytes.length, bytes.byteLength)
  assert.equal(put.headers.get("x-folvio-recipient"), null, "an existing recipient is not issued a new id")

  const mine = await (await api("/files?folder=Branding/Logos", { headers: { "x-folvio-recipient": recipient } })).json()
  assert.deepEqual(mine.files.map((f: { name: string }) => f.name), ["logo.svg"])
  const stranger = await (await api("/files?folder=Branding/Logos")).json()
  assert.equal(stranger.files.length, 0, "another program does not see those files")
  assert.equal((await api("/upload/x.txt?folder=Nope", { method: "PUT", body: "x", headers: { "content-length": "1" } })).status, 404)
  assert.equal((await api("/upload/x.txt", { method: "PUT", body: "xy", headers: { "content-length": "5" } })).status >= 400, true)

  const locked = await createCollection(env, { name: "Locked", password: "pw" })
  const lockedApi = (headers: Record<string, string>) => handleApi(new Request(`https://x.test/api/v1/share/${locked.token}`, { headers }), env, ctx)
  assert.equal((await lockedApi({})).status, 401)
  assert.equal((await lockedApi({ "x-folvio-password": "bad" })).status, 401)
  assert.equal((await lockedApi({ "x-folvio-password": "pw" })).status, 200)
})

async function findCollectionId(env: Env, token: string): Promise<string> {
  return (await env.DB.prepare("SELECT id FROM collections WHERE token = ?").bind(token).first<{ id: string }>())!.id
}

test("a folder lists everything inside it; recipients see their own files, or all with show_files", async () => {
  const { env } = makeEnv()
  const { id, token } = await createCollection(env, { name: "C" }, [{ id: "a", name: "Images", parent: null }, { id: "b", name: "Team", parent: "a" }, { id: "h", name: "Secret", parent: null }])
  let admin = await adminAccess(env, id)
  const [images, team, secret] = ["Images", "Team", "Secret"].map((n) => admin.folders.find((f) => f.name === n)!.id)
  await updateFolder(env, admin, secret, { hidden: true })
  admin = await adminAccess(env, id)
  const put = async (access: Awaited<ReturnType<typeof adminAccess>>, name: string, folder: string | null) => {
    const up = await initUpload(env, access, { name, size: 1, folder })
    await completeUpload(env, access, up.id, { parts: [await uploadPart(env, access, up.id, 1, partRequest(new Uint8Array(1)))] })
    return up.id
  }
  const opener = async () => {
    const { cookie } = await openShare(new Request("https://x.test/"), env, (await adminAccess(env, id)).c, "")
    return recipientAccess(new Request("https://x.test/", { headers: { cookie: cookie.split(";")[0] } }), env, token)
  }
  const alice = await opener()
  const bob = await opener()
  await put(admin, "secret.txt", secret)
  const deep = await put(alice, "deep.png", team)
  await put(bob, "bob.png", images)

  // the root shows everything inside it
  assert.equal((await listFiles(env, admin, { folder: null })).files.length, 0, "nothing directly in the root")
  assert.equal((await listFiles(env, admin, { folder: null, recursive: true })).files.length, 3)
  assert.deepEqual((await listFiles(env, alice, { folder: null, recursive: true })).files.map((f) => f.name), ["deep.png"])
  assert.equal(await status(getFile(env, bob, deep)), 404, "bob cannot open alice's file")
  assert.equal((await getFile(env, alice, deep)).name, "deep.png", "alice can open her own file")

  const counts = await folderCounts(env, admin)
  assert.deepEqual([counts[""].total, counts[images].total, counts[images].files, counts[team].files], [3, 2, 1, 1])

  // shared collections: everyone sees every visible file, never the hidden folder
  await updateCollection(env, (await adminAccess(env, id)).c, { show_files: true })
  const bob2 = await recipientAccess(new Request("https://x.test/", { headers: { cookie: `fv_${id}=${(await openShare(new Request("https://x.test/"), env, (await adminAccess(env, id)).c, "")).recipient}` } }), env, token)
  assert.deepEqual((await listFiles(env, bob2, { folder: null, recursive: true })).files.map((f) => f.name).sort(), ["bob.png", "deep.png"])
  assert.equal((await getFile(env, bob2, deep)).name, "deep.png")
  assert.equal((await folderCounts(env, bob2))[""].total, 2)
})

test("collections set to auto-delete are removed with their files once expired; others are kept", async () => {
  const { env, raw, objects } = makeEnv()
  assert.equal(await status(createCollection(env, { name: "No date", auto_delete: true })), 400, "auto-delete needs an expiry")
  const gone = await createCollection(env, { name: "Gone", expires: Date.now() + 60_000, auto_delete: true }, [{ id: "a", name: "A", parent: null }])
  const kept = await createCollection(env, { name: "Kept", expires: Date.now() + 60_000 })
  for (const id of [gone.id, kept.id]) {
    const access = await adminAccess(env, id)
    const up = await initUpload(env, access, { name: "f.txt", size: 2 })
    await completeUpload(env, access, up.id, { parts: [await uploadPart(env, access, up.id, 1, partRequest(new Uint8Array(2)))] })
  }
  await createLink(env, await adminAccess(env, gone.id), (await adminAccess(env, gone.id)).folders[0].id)
  assert.equal(await purgeExpired(env), 0, "not expired yet")
  const later = Date.now() + 120_000
  assert.equal(await purgeExpired(env, later), 1)
  assert.equal(raw.prepare("SELECT count(*) AS n FROM collections").get()!.n, 1)
  assert.equal(raw.prepare("SELECT name FROM collections").get()!.name, "Kept")
  assert.equal(raw.prepare("SELECT count(*) AS n FROM folder_links").get()!.n, 0)
  assert.equal(objects.size, 1, "only the kept collection's file remains")
})

test("recipients only create top-level folders, whatever parent they ask for", async () => {
  const { env } = makeEnv()
  const { id, token } = await createCollection(env, { name: "C", create_folder: true }, [{ id: "a", name: "Images", parent: null }])
  const admin = await adminAccess(env, id)
  const images = admin.folders[0].id
  const { cookie } = await openShare(new Request("https://x.test/"), env, admin.c, "")
  const r = await recipientAccess(new Request("https://x.test/", { headers: { cookie: cookie.split(";")[0] } }), env, token)
  const made = await createFolder(env, r, { name: "Mine", parent: images })
  assert.equal((await adminAccess(env, id)).folders.find((f) => f.id === made)!.parent, null)
  // the administrator still nests
  const nested = await createFolder(env, await adminAccess(env, id), { name: "Sub", parent: images })
  assert.equal((await adminAccess(env, id)).folders.find((f) => f.id === nested)!.parent, images)
  // through a folder link, the top level is the link's folder
  const link = await createLink(env, await adminAccess(env, id), images)
  const { cookie: c2 } = await openShare(new Request("https://x.test/"), env, (await adminAccess(env, id)).c, "")
  const scoped = await recipientAccess(new Request("https://x.test/", { headers: { cookie: c2.split(";")[0] } }), env, link.token)
  const inLink = await createFolder(env, scoped, { name: "Linked", parent: null })
  assert.equal((await adminAccess(env, id)).folders.find((f) => f.id === inLink)!.parent, images)
})

test("SVG files are accepted but never previewed or served as something a browser would run", async () => {
  const { env } = makeEnv()
  const { ctx } = makeCtx()
  const { id, token } = await createCollection(env, { name: "C", show_files: true })
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>')
  const api = (path: string, init: RequestInit = {}) => handleApi(new Request(`https://x.test/api/v1/share/${token}${path}`, init), env, ctx)
  const put = await api("/upload/logo.svg", { method: "PUT", body: svg, headers: { "content-length": String(svg.byteLength) } })
  assert.equal(put.status, 201, "SVG uploads are accepted")
  const { id: fileId } = await put.json()
  const recipient = put.headers.get("x-folvio-recipient")!
  assert.equal((await api(`/files/${fileId}/preview`, { headers: { "x-folvio-recipient": recipient } })).status, 400, "no inline preview for SVG")
  const { secret } = await createApiKey(env, "k")
  const download = await handleApi(new Request(`https://x.test/api/v1/collections/${id}/files/${fileId}/download`, { headers: { authorization: `Bearer ${secret}` } }), env, ctx)
  assert.equal(download.status, 200)
  assert.equal(download.headers.get("content-type"), "application/octet-stream")
  assert.match(download.headers.get("content-disposition")!, /^attachment;/)
  assert.equal(download.headers.get("x-content-type-options"), "nosniff")
  assert.match(download.headers.get("content-security-policy")!, /sandbox/)
  assert.equal(new TextDecoder().decode(await download.arrayBuffer()), new TextDecoder().decode(svg), "stored unchanged")
})
