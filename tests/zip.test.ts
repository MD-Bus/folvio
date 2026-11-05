import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, ZipWriter } from "../app/lib/zip-writer.ts"

const stream = (bytes: Uint8Array, chunk = 7) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.subarray(i, i + chunk))
      c.close()
    },
  })

test("crc32 matches the reference value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926)
})

test("the archive opens with standard tools, with folders, UTF-8 names and intact contents", async () => {
  const chunks: Uint8Array[] = []
  const zip = new ZipWriter({ write: (c) => void chunks.push(c.slice()), close: () => {} })
  const big = new Uint8Array(300_000).map((_, i) => (i * 31) % 251)
  await zip.addDirectory("Branding/")
  await zip.addDirectory("Branding/Empty/")
  await zip.addFile("Branding/logo café.svg", stream(new TextEncoder().encode("<svg/>")))
  await zip.addFile("photo.bin", stream(big, 65_536))
  await zip.finish()
  const dir = mkdtempSync(join(tmpdir(), "zip-"))
  const file = join(dir, "out.zip")
  writeFileSync(file, Buffer.concat(chunks))
  const check = execFileSync("python3", ["-I", "-c", `
import zipfile, sys, hashlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(sorted(z.namelist()))
print(z.read("Branding/logo café.svg").decode(), hashlib.sha256(z.read("photo.bin")).hexdigest())
`, file], { encoding: "utf8" })
  const lines = check.trim().split("\n")
  assert.equal(lines[0], "['Branding/', 'Branding/Empty/', 'Branding/logo café.svg', 'photo.bin']")
  const sha = (await import("node:crypto")).createHash("sha256").update(big).digest("hex")
  assert.equal(lines[1], `<svg/> ${sha}`)
})
