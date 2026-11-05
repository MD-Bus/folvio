// Isolated staging only. Never point this at an existing installation: it rotates test login secrets.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
const config = JSON.parse(await readFile("wrangler.staging.json", "utf8"));
assert.match(config.name, /^folvio-verify-/);
const origin =
  process.env.FOLVIO_STAGING_ORIGIN ||
  "https://folvio-verify-20261104.development-689.workers.dev";
assert.ok(new URL(origin).hostname.startsWith(config.name + "."));
const auth = await readFile(
  process.env.WRANGLER_AUTH_FILE ||
    join(homedir(), "Library/Preferences/.wrangler/config/default.toml"),
  "utf8",
);
const token = auth.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
assert.ok(token);
async function cf(path, method = "GET", data) {
  const r = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + config.account_id + path,
    {
      method,
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: data ? JSON.stringify(data) : undefined,
    },
  );
  const j = await r.json();
  if (!j.success) throw Error(JSON.stringify(j.errors));
  return j.result;
}
const password = crypto.randomUUID() + crypto.randomUUID();
for (const [name, text] of Object.entries({
  ADMIN_USERNAME: "verification-admin",
  ADMIN_PASSWORD: password,
  SESSION_SECRET: crypto.randomUUID() + crypto.randomUUID(),
}))
  await cf("/workers/scripts/" + config.name + "/secrets", "PUT", {
    name,
    text,
    type: "secret_text",
  });
let adminCookie = "";
async function req(path, method = "GET", data, cookie = adminCookie) {
  const r = await fetch(origin + "/api/" + path, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) throw Error(`${method} ${path}: ${r.status} ${JSON.stringify(b)}`);
  return { data: b, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
for (let attempt = 0; attempt < 6; attempt++) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    adminCookie = (
      await req("session", "POST", { username: "verification-admin", password })
    ).cookie;
    if ((await req("session")).data.username) break;
  } catch (error) {
    if (attempt === 5) throw error;
  }
}
assert.ok(
  (await req("session")).data.username,
  "Secret deployment has not converged",
);
const collection = (
  await req("collections", "POST", {
    name: "Staging verification",
    max_file: 150000000,
  })
).data;
const base = "collections/" + collection.id,
  share = "share/" + collection.token;
const folder = (
  await req(base + "/folders", "POST", { name: "Prepared folder" })
).data;
const recipient = (await req(share + "/open", "POST", {})).cookie;
let denied = await fetch(origin + "/api/" + share + "/folders", {
  method: "POST",
  headers: { cookie: recipient, "content-type": "application/json" },
  body: JSON.stringify({ name: "Denied" }),
});
assert.equal(denied.status, 403);
await req(base, "PATCH", { create_folder: true });
await req(
  share + "/folders",
  "POST",
  { name: "Allowed", parent: folder.id },
  recipient,
);
for (const path of ["/", "/app.js"]) {
  const r = await fetch(origin + path);
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("content-security-policy"));
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
}
console.log(
  "PASS: remote D1 migrations, authentication, folder permissions, static security headers",
);
if (!process.argv.includes("--cleanup-only")) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
    const page = await browser.newPage();
    await page.goto(origin + "/s/" + collection.token);
    await page.waitForSelector("#upload");
    await page.click('[data-folder="' + folder.id + '"]');
    await page.waitForSelector("#upload");
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["UI upload verification"], "ui-upload.txt"));
      const input = document.querySelector("#upload");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector("#file-list")
          ?.textContent.includes("ui-upload.txt"),
      { timeout: 60000 },
    );
    const result = await page.evaluate(
      async ({ share, folder }) => {
        const request = async (path, data) => {
          const r = await fetch("/api/" + share + path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(data),
          });
          const j = await r.json();
          if (!r.ok) throw Error(JSON.stringify(j));
          return j;
        };
        const results = [];
        for (const size of [13, 105 * 1024 * 1024]) {
          const up = await request("/uploads", {
            folder,
            name: "verification-" + size + ".bin",
            size,
          });
          const parts = [];
          for (let part = 1; part <= up.parts; part++) {
            const signed = await request("/uploads/" + up.id + "/part", {
              part,
            });
            if (part === 1) {
              const bad = await fetch(signed.url, {
                method: "PUT",
                body: new Blob([new Uint8Array(signed.size + 1)]),
              });
              if (bad.ok) throw Error("Oversized signed part was accepted");
            }
            const response = await fetch(signed.url, {
              method: "PUT",
              body: new Blob([new Uint8Array(signed.size)]),
            });
            if (!response.ok)
              throw Error(
                "R2 PUT " + response.status + " " + (await response.text()),
              );
            parts.push(await response.json());
          }
          await request("/uploads/" + up.id + "/complete", { parts });
          results.push({ id: up.id, size });
        }
        return results;
      },
      { share, folder: folder.id },
    );
    const files = (await req(base + "/files?folder=" + folder.id)).data;
    assert.equal(files.length, 3);
    for (const file of files) {
      const download = (await req(base + "/files/" + file.id)).data;
      const response = await fetch(download.url, {
        headers: { cookie: adminCookie },
      });
      assert.equal(response.status, 200);
      assert.equal(Number(response.headers.get("content-length")), file.size);
      await response.body.cancel();
      await req(base + "/files/" + file.id, "DELETE");
    }
    console.log(
      "PASS: real browser-to-Worker-to-R2 13-byte and 105-MiB uploads, exact-size rejection, streamed parts, completion, correct folder, authenticated download, deletion",
    );
  } finally {
    await browser?.close();
  }
}
const scoped = (await req(base + "/links", "POST", { folder: folder.id })).data;
const scopedPath = "share/" + scoped.token;
const scopedCookie = (await req(scopedPath + "/open", "POST", {})).cookie;
const view = (await req(scopedPath, "GET", undefined, scopedCookie)).data;
assert.equal(view.token, scoped.token);
assert.equal(view.folder_root, folder.id);
const sibling = (
  await req(base + "/folders", "POST", { name: "Outside scoped link" })
).data;
const outside = await fetch(origin + "/api/" + scopedPath + "/uploads", {
  method: "POST",
  headers: { cookie: scopedCookie, "content-type": "application/json" },
  body: JSON.stringify({ name: "escape", size: 5, folder: sibling.id }),
});
assert.equal(outside.status, 403);
await req(base + "/links/" + scoped.token, "DELETE");
const abandoned = (
  await req(base + "/uploads", "POST", { name: "Abandoned", size: 5 })
).data;
await cf(
  "/d1/database/" + config.d1_databases[0].database_id + "/query",
  "POST",
  { sql: "UPDATE uploads SET expires=1 WHERE id=?", params: [abandoned.id] },
);
const cleaned = await fetch(origin + "/api/__verify/cleanup", {
  method: "POST",
  headers: { authorization: "Bearer " + password },
});
assert.equal(cleaned.status, 200);
const remaining = await cf(
  "/d1/database/" + config.d1_databases[0].database_id + "/query",
  "POST",
  { sql: "SELECT id FROM uploads WHERE id=?", params: [abandoned.id] },
);
assert.equal(remaining[0].results.length, 0);
console.log(
  "PASS: live directory-link isolation/revocation and scheduled cleanup handler with real D1/R2",
);
await req("session", "DELETE");
