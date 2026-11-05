import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "./harness.js";
import { cleanup } from "../src/index.js";
async function setup(t, limit = 100) {
  const password = crypto.randomUUID();
  const mf = new Miniflare({
    bindings: {
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: password,
      STORAGE_LIMIT_BYTES: String(limit),
    },
  });
  t.after(() => mf.dispose());
  for (const file of (await readdir("migrations")).sort())
    await mf.DB.exec(await readFile("migrations/" + file, "utf8"));
  async function req(path, method = "GET", data, cookie = adminCookie) {
    const r = await mf.dispatchFetch("https://test.example/api/" + path, {
      method,
      headers: { cookie: cookie || "", "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  let adminCookie = "";
  adminCookie = (await req("session", "POST", { username: "admin", password }))
    .cookie;
  const c = (
    await req("collections", "POST", { name: "Test", max_file: 20000000 })
  ).data;
  const base = "collections/" + c.id,
    share = "share/" + c.token;
  return { mf, req, base, share, c, adminCookie };
}
test("invalid bodies and manifests produce client errors", async (t) => {
  const { req, base } = await setup(t);
  for (const body of [null, [], 1, "text"])
    assert.equal((await req(base, "PATCH", body)).status, 400);
  const init = await req(base + "/uploads", "POST", { name: "a", size: 5 });
  for (const parts of [[null], [{}], [{ partNumber: 0, etag: "x" }]])
    assert.equal(
      (
        await req(base + "/uploads/" + init.data.id + "/complete", "POST", {
          parts,
        })
      ).status,
      400,
    );
});
test("concurrent quota reservations never overbook and cancellation releases bytes", async (t) => {
  const { req, base, mf } = await setup(t);
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, n) =>
      req(base + "/uploads", "POST", { name: "file" + n, size: 30 }),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === 201).length, 3);
  assert.equal(
    (await mf.DB.prepare("SELECT sum(size) AS total FROM uploads").first())
      .total,
    90,
  );
  const id = attempts.find((x) => x.status === 201).data.id;
  assert.equal((await req(base + "/uploads/" + id, "DELETE")).status, 200);
  assert.equal(
    (await req(base + "/uploads", "POST", { name: "replacement", size: 30 }))
      .status,
    201,
  );
});
test("recipient cookie isolation, forged signatures and foreign folders are denied", async (t) => {
  const { req, base, share } = await setup(t);
  const a = await req(share + "/open", "POST", {}),
    b = await req(share + "/open", "POST", {});
  const up = await req(
    share + "/uploads",
    "POST",
    { name: "a", size: 5 },
    a.cookie,
  );
  assert.equal(
    (
      await req(
        share + "/uploads/" + up.data.id + "/part",
        "POST",
        { part: 1 },
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (await req(share, "GET", undefined, a.cookie.slice(0, -1) + "!")).status,
    401,
  );
  const other = (await req("collections", "POST", { name: "Other" })).data;
  const folder = (
    await req("collections/" + other.id + "/folders", "POST", {
      name: "Private",
    })
  ).data;
  assert.equal(
    (
      await req(base + "/uploads", "POST", {
        name: "foreign",
        size: 5,
        folder: folder.id,
      })
    ).status,
    404,
  );
});
test("size mismatch removes the object and reservation; completion is retryable", async (t) => {
  const { req, base, mf } = await setup(t);
  let init = await req(base + "/uploads", "POST", { name: "bad", size: 5 });
  let up = await mf.DB.prepare("SELECT * FROM uploads WHERE id=?")
    .bind(init.data.id)
    .first();
  let part = await mf.FILES.resumeMultipartUpload(
    up.object_key,
    up.multipart,
  ).uploadPart(1, new Uint8Array(6));
  assert.equal(
    (
      await req(base + "/uploads/" + up.id + "/complete", "POST", {
        parts: [part],
      })
    ).status,
    400,
  );
  assert.equal(await mf.FILES.head(up.object_key), null);
  assert.equal(
    await mf.DB.prepare("SELECT * FROM uploads WHERE id=?").bind(up.id).first(),
    null,
  );
  init = await req(base + "/uploads", "POST", { name: "good", size: 5 });
  up = await mf.DB.prepare("SELECT * FROM uploads WHERE id=?")
    .bind(init.data.id)
    .first();
  part = await mf.FILES.resumeMultipartUpload(
    up.object_key,
    up.multipart,
  ).uploadPart(1, new Uint8Array(5));
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await req(base + "/uploads/" + up.id + "/complete", "POST", {
          parts: [part],
        })
      ).status,
      200,
    );
  assert.equal((await req(base + "/uploads/" + up.id, "DELETE")).status, 409);
  assert.equal((await req(base + "/files/" + up.id, "DELETE")).status, 200);
});
test("cleanup is bounded and retains reservations on storage failure", async (t) => {
  const { req, base, mf } = await setup(t);
  for (let i = 0; i < 7; i++)
    assert.equal(
      (await req(base + "/uploads", "POST", { name: "old" + i, size: 5 }))
        .status,
      201,
    );
  await mf.DB.prepare("UPDATE uploads SET expires=1").run();
  const remove = mf.FILES.delete;
  mf.FILES.delete = async () => {
    throw Error("storage unavailable");
  };
  await cleanup(mf.env);
  assert.equal(
    (await mf.DB.prepare("SELECT count(*) AS n FROM uploads").first()).n,
    7,
  );
  mf.FILES.delete = remove;
  await cleanup(mf.env);
  assert.equal(
    (await mf.DB.prepare("SELECT count(*) AS n FROM uploads").first()).n,
    2,
  );
  await cleanup(mf.env);
  assert.equal(
    (await mf.DB.prepare("SELECT count(*) AS n FROM uploads").first()).n,
    0,
  );
});
test("folder revisions change for permission edits and prevent stale updates", async (t) => {
  const { req, base, mf, c } = await setup(t);
  const f = (await req(base + "/folders", "POST", { name: "Root" })).data;
  const before = await mf.DB.prepare(
    "SELECT revision FROM collections WHERE id=?",
  )
    .bind(c.id)
    .first();
  await req(base + "/folders/" + f.id, "PATCH", { upload: false });
  const after = await mf.DB.prepare(
    "SELECT revision FROM collections WHERE id=?",
  )
    .bind(c.id)
    .first();
  assert.ok(after.revision > before.revision);
  const result = await mf.DB.prepare(
    "UPDATE folders SET upload=1 WHERE id=? AND (SELECT revision FROM collections WHERE id=?)=?",
  )
    .bind(f.id, c.id, before.revision)
    .run();
  assert.equal(result.meta.changes, 0);
});
test("multipart boundary sizes are exact without streaming bytes through Worker", async (t) => {
  const { req, base } = await setup(t, 20000000);
  const size = 16 * 1024 * 1024 + 7;
  const up = await req(base + "/uploads", "POST", { name: "large", size });
  assert.equal(up.data.parts, 2);
  for (const [part, expected] of [
    [1, 16 * 1024 * 1024],
    [2, 7],
  ])
    assert.equal(
      (await req(base + "/uploads/" + up.data.id + "/part", "POST", { part }))
        .data.size,
      expected,
    );
  assert.equal(
    (await req(base + "/uploads/" + up.data.id + "/part", "POST", { part: 3 }))
      .status,
    400,
  );
});
test("login throttling blocks request 31 and cookies carry HTTPS protections", async (t) => {
  const { req, adminCookie, mf } = await setup(t);
  assert.ok(adminCookie);
  for (let i = 0; i < 29; i++)
    assert.equal(
      (
        await req(
          "session",
          "POST",
          { username: "wrong", password: "wrong" },
          "",
        )
      ).status,
      401,
    );
  assert.equal(
    (await req("session", "POST", { username: "wrong", password: "wrong" }, ""))
      .status,
    429,
  );
  const response = await mf.dispatchFetch("https://test.example/api/session", {
    method: "DELETE",
  });
  assert.match(
    response.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict; Max-Age=0; Secure/,
  );
});

test("cancellation cannot delete an upload while completion is in progress", async (t) => {
  const { req, base, mf } = await setup(t);
  const init = await req(base + "/uploads", "POST", { name: "race", size: 5 });
  const up = await mf.DB.prepare("SELECT * FROM uploads WHERE id=?")
    .bind(init.data.id)
    .first();
  const part = await mf.FILES.resumeMultipartUpload(
    up.object_key,
    up.multipart,
  ).uploadPart(1, new Uint8Array(5));
  let release, entered;
  const waiting = new Promise((resolve) => (entered = resolve));
  const paused = new Promise((resolve) => (release = resolve));
  const head = mf.FILES.head;
  let first = true;
  mf.FILES.head = async (key) => {
    if (first) {
      first = false;
      entered();
      await paused;
    }
    return head(key);
  };
  const completion = req(base + "/uploads/" + up.id + "/complete", "POST", {
    parts: [part],
  });
  await waiting;
  try {
    assert.equal((await req(base + "/uploads/" + up.id, "DELETE")).status, 409);
  } finally {
    release();
  }
  assert.equal((await completion).status, 200);
  assert.equal((await head(up.object_key)).size, 5);
});
test("request body limit is enforced without relying on Content-Length", async (t) => {
  const { mf, base, adminCookie } = await setup(t);
  const response = await mf.dispatchFetch("https://test.example/api/" + base, {
    method: "PATCH",
    headers: { cookie: adminCookie },
    body: JSON.stringify({ description: "x".repeat(33000) }),
  });
  assert.equal(response.status, 413);
});

test("directory links cannot escape their subtree or disclose the collection token", async (t) => {
  const { req, base, c } = await setup(t);
  const root = (await req(base + "/folders", "POST", { name: "Shared" })).data;
  const other = (await req(base + "/folders", "POST", { name: "Private" }))
    .data;
  const child = (
    await req(base + "/folders", "POST", { name: "Child", parent: root.id })
  ).data;
  await req(base, "PATCH", { create_folder: true });
  const link = (await req(base + "/links", "POST", { folder: root.id })).data;
  const share = "share/" + link.token;
  const cookie = (await req(share + "/open", "POST", {})).cookie;
  const view = await req(share, "GET", undefined, cookie);
  assert.equal(view.data.token, link.token);
  assert.notEqual(view.data.token, c.token);
  assert.deepEqual(
    view.data.folders.map((f) => f.id).sort(),
    [root.id, child.id].sort(),
  );
  assert.equal(view.data.folder_root, root.id);
  assert.equal(
    (await req(share + "/files?folder=" + other.id, "GET", undefined, cookie))
      .status,
    403,
  );
  assert.equal(
    (
      await req(
        share + "/uploads",
        "POST",
        { folder: other.id, name: "escape", size: 5 },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await req(
        share + "/folders",
        "POST",
        { parent: other.id, name: "escape" },
        cookie,
      )
    ).status,
    403,
  );
  const created = await req(
    share + "/folders",
    "POST",
    { name: "Within" },
    cookie,
  );
  assert.equal(created.status, 201);
  assert.equal(
    (
      await req(
        share + "/uploads",
        "POST",
        { name: "root upload", size: 5 },
        cookie,
      )
    ).status,
    201,
  );
  await req(base + "/links/" + link.token, "DELETE");
  assert.equal((await req(share, "GET", undefined, cookie)).status, 404);
});

test("Worker streams parts, supports file management and protects downloads", async (t) => {
  const { req, base, mf, adminCookie, share } = await setup(t);
  const init = (
    await req(base + "/uploads", "POST", { name: "received.txt", size: 5 })
  ).data;
  const part = (
    await req(base + "/uploads/" + init.id + "/part", "POST", { part: 1 })
  ).data;
  let response = await mf.dispatchFetch(part.url, {
    method: "PUT",
    headers: { cookie: adminCookie, "content-length": "6" },
    body: "longer",
  });
  assert.equal(response.status, 400);
  response = await mf.dispatchFetch(part.url, {
    method: "PUT",
    headers: { cookie: adminCookie, "content-length": "5" },
    body: "hello",
  });
  assert.equal(response.status, 200);
  await req(base + "/uploads/" + init.id + "/complete", "POST", {
    parts: [await response.json()],
  });
  const folder = (await req(base + "/folders", "POST", { name: "Archive" }))
    .data;
  assert.equal(
    (
      await req(base + "/files/" + init.id, "PATCH", {
        name: "renamed.txt",
        folder: folder.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (await req(base + "/files?folder=" + folder.id)).data[0].name,
    "renamed.txt",
  );
  const url = (await req(base + "/files/" + init.id)).data.url;
  assert.equal((await mf.dispatchFetch(url)).status, 401);
  response = await mf.dispatchFetch(url, { headers: { cookie: adminCookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment/);
  assert.equal((await response.arrayBuffer()).byteLength, 5);
  const cookie = (await req(share + "/open", "POST", {})).cookie;
  assert.equal(
    (await req(share + "/files/" + init.id, "GET", undefined, cookie)).status,
    403,
  );
});
