const encoder = new TextEncoder();
export const hex = (b) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async (s) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
export async function hmac(key, data, raw = false) {
  const k = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign("HMAC", k, encoder.encode(data));
  return raw ? result : hex(result);
}
export function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const cookieValue = (r, n) =>
  r.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(n + "="))
    ?.slice(n.length + 1);
export const cookie = (r, n, v, age = 604800) =>
  `${n}=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(r.url).protocol === "https:" ? "; Secure" : ""}`;
export const fingerprint = (e) =>
  hmac(
    e.SESSION_SECRET || e.ADMIN_PASSWORD,
    `${e.ADMIN_USERNAME}:${e.ADMIN_PASSWORD}`,
  );
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export function name(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 180 ||
    /[\x00-\x1f/\\]/.test(value)
  )
    fail(400, "Enter a name of 1–180 characters without slashes.");
  return value.trim();
}
export function integer(v, min, max) {
  if (!Number.isSafeInteger(v) || v < min || v > max)
    fail(400, `Expected a whole number from ${min} to ${max}.`);
  return v;
}
// Ancestor hidden status cannot be overridden. Other permissions inherit nearest explicit value.
export function permissions(collection, folders, id) {
  const chain = [];
  const seen = new Set();
  let current = id;
  while (current) {
    if (seen.has(current) || chain.length >= 20)
      fail(400, "Invalid folder hierarchy.");
    seen.add(current);
    const f = folders.find((x) => x.id === current);
    if (!f || f.collection !== collection.id) fail(404, "Folder not found.");
    chain.push(f);
    current = f.parent;
  }
  const result = {
    upload: !!collection.upload,
    create_folder: !!collection.create_folder,
    rename_own: !!collection.rename_own,
    hidden: false,
  };
  for (const f of chain.reverse()) {
    for (const k of ["upload", "create_folder", "rename_own"])
      if (f[k] !== null && f[k] !== undefined) result[k] = !!f[k];
    if (f.hidden) result.hidden = true;
  }
  return result;
}
