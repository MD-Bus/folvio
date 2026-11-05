import { test } from "node:test";
import assert from "node:assert/strict";
import { permissions, name } from "../src/security.js";
test("permissions inherit, hide descendants, reject foreign folders", () => {
  const c = { id: "c", upload: 1, create_folder: 0, rename_own: 0 };
  const fs = [
    { id: "a", collection: "c", parent: null, upload: 0, hidden: 1 },
    { id: "b", collection: "c", parent: "a", upload: 1, create_folder: 1 },
  ];
  assert.equal(permissions(c, fs, null).create_folder, false);
  assert.deepEqual(permissions(c, fs, "b"), {
    upload: true,
    create_folder: true,
    rename_own: false,
    hidden: true,
  });
  assert.throws(() => permissions(c, fs, "foreign"));
  assert.throws(() =>
    permissions(c, [{ id: "a", collection: "c", parent: "a" }], "a"),
  );
});
test("file names reject path injection", () => {
  assert.throws(() => name("../test"));
  assert.throws(() => name("a\0b"));
  assert.equal(name("Logo.svg"), "Logo.svg");
});
