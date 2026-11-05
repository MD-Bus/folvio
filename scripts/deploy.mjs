// Provision the named resources before deploying, following imghost's deployment pattern.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const flag = process.argv.indexOf("--config");
const path = resolve(flag >= 0 ? process.argv[flag + 1] : "wrangler.jsonc");
const config = JSON.parse(readFileSync(path, "utf8"));
const cli = resolve("node_modules/wrangler/bin/wrangler.js");
function run(args) {
  return execFileSync(process.execPath, [cli, ...args, "--config", path], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      ...(config.account_id
        ? { CLOUDFLARE_ACCOUNT_ID: config.account_id }
        : {}),
    },
  });
}
const database = config.d1_databases.find((b) => b.binding === "DB");
const existing = JSON.parse(run(["d1", "list", "--json"])).find(
  (d) => d.name === database.database_name,
);
let id = existing?.uuid;
if (!id) {
  const output = run(["d1", "create", database.database_name]);
  id = output.match(/"database_id"\s*:\s*"([a-f0-9-]+)"/i)?.[1];
  if (!id) throw Error("Could not resolve the created database ID.");
}
database.database_id = id;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
const bucket = config.r2_buckets.find((b) => b.binding === "FILES").bucket_name;
const list = run(["r2", "bucket", "list"]);
if (
  !list
    .split("\n")
    .some(
      (line) =>
        line.trim() === `name:           ${bucket}` ||
        (/^name:\s+/.test(line) &&
          line.replace(/^name:\s+/, "").trim() === bucket),
    )
)
  console.log(run(["r2", "bucket", "create", bucket]));
console.log(run(["d1", "migrations", "apply", "DB", "--remote"]));
const rules = run(["r2", "bucket", "lifecycle", "list", bucket]);
if (!rules.includes("folvio-abort-incomplete"))
  console.log(
    run([
      "r2",
      "bucket",
      "lifecycle",
      "add",
      bucket,
      "folvio-abort-incomplete",
      "",
      "--abort-multipart-days",
      "1",
      "--force",
    ]),
  );
console.log(run(["deploy"]));
