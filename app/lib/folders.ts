/**
 * Folder trees and permissions, shared by the Worker (which enforces them) and the dashboard (which shows them).
 *
 * Each folder may override three recipient permissions of the collection (upload, create subfolders, rename own
 * folders); `null` inherits from the nearest ancestor that sets it, then from the collection. A hidden folder hides
 * its whole subtree from recipients, and no descendant can undo that.
 */
export const PERMISSIONS = ["upload", "create_folder", "rename_own"] as const
export type Permission = (typeof PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<Permission, string> = {
  upload: "Upload files",
  create_folder: "Create subfolders",
  rename_own: "Rename their own folders",
}

export type CollectionPermissions = { upload: number | boolean; create_folder: number | boolean; rename_own: number | boolean }

export type FolderRow = {
  id: string
  collection: string
  parent: string | null
  name: string
  creator: string
  upload: number | null
  create_folder: number | null
  rename_own: number | null
  hidden: number
}

export type Effective = Record<Permission, boolean> & { hidden: boolean }

/** Deepest allowed nesting: a folder chain longer than this is rejected. */
export const MAX_DEPTH = 20
/** Folders per collection. */
export const MAX_FOLDERS = 200

export class FolderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** The chain from the root down to `id` (inclusive). Throws on unknown folders and cycles. */
export function ancestry<T extends Pick<FolderRow, "id" | "parent">>(folders: T[], id: string | null): T[] {
  const chain: T[] = []
  const seen = new Set<string>()
  let current = id
  while (current) {
    if (seen.has(current) || chain.length >= MAX_DEPTH) throw new FolderError(400, "Invalid folder hierarchy.")
    seen.add(current)
    const folder = folders.find((f) => f.id === current)
    if (!folder) throw new FolderError(404, "Folder not found.")
    chain.push(folder)
    current = folder.parent
  }
  return chain.reverse()
}

/** Effective recipient permissions at `id` (null: the collection root). */
export function effectivePermissions(collection: CollectionPermissions, folders: FolderRow[], id: string | null): Effective {
  const result: Effective = { upload: !!collection.upload, create_folder: !!collection.create_folder, rename_own: !!collection.rename_own, hidden: false }
  for (const folder of ancestry(folders, id)) {
    for (const key of PERMISSIONS) if (folder[key] !== null && folder[key] !== undefined) result[key] = !!folder[key]
    if (folder.hidden) result.hidden = true
  }
  return result
}

/** True when `id` is `root` or one of its descendants. A null root contains everything. */
export function isWithin<T extends Pick<FolderRow, "id" | "parent">>(folders: T[], id: string | null, root: string | null): boolean {
  if (!root) return true
  const seen = new Set<string>()
  let current = id
  while (current && !seen.has(current)) {
    if (current === root) return true
    seen.add(current)
    current = folders.find((f) => f.id === current)?.parent ?? null
  }
  return false
}

/** Ids of `id` and everything below it. */
export function subtreeIds<T extends Pick<FolderRow, "id" | "parent">>(folders: T[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) if (f.parent && out.has(f.parent) && !out.has(f.id)) out.add(f.id), (grew = true)
  }
  return out
}

/** "Branding / Logos" */
export function folderPath<T extends Pick<FolderRow, "id" | "parent" | "name">>(folders: T[], id: string | null, separator = " / "): string {
  try {
    return ancestry(folders, id)
      .map((f) => f.name)
      .join(separator)
  } catch {
    return ""
  }
}

export type TreeNode<T> = T & { depth: number; children: TreeNode<T>[] }

/** The folders as a sorted tree below `root`. */
export function buildTree<T extends Pick<FolderRow, "id" | "parent" | "name">>(folders: T[], root: string | null = null, depth = 0): TreeNode<T>[] {
  return folders
    .filter((f) => f.parent === root)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((f) => ({ ...f, depth, children: buildTree(folders, f.id, depth + 1) }))
}

/** The tree flattened in display order. */
export function flatten<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

/** Validates a folder or file name: 1-180 characters, no slashes or control characters. */
export function cleanName(value: unknown, what = "name"): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 180 || /[\x00-\x1f/\\]/.test(value)) {
    throw new FolderError(400, `Enter a ${what} of 1-180 characters without slashes.`)
  }
  return value.trim()
}

/** A folder planned in the dashboard before the collection exists. `id` and `parent` are temporary ids. */
export type DraftFolder = { id: string; name: string; parent: string | null }

/** Checks a planned tree: names, duplicates, depth, size and that every parent exists. Returns it parents-first. */
export function validateDraft(drafts: DraftFolder[]): DraftFolder[] {
  if (!Array.isArray(drafts)) throw new FolderError(400, "Invalid folder list.")
  if (drafts.length > MAX_FOLDERS) throw new FolderError(400, `A collection holds at most ${MAX_FOLDERS} folders.`)
  const ids = new Set<string>()
  const clean = drafts.map((d) => {
    if (!d || typeof d.id !== "string" || !d.id || ids.has(d.id)) throw new FolderError(400, "Invalid folder list.")
    ids.add(d.id)
    return { id: d.id, name: cleanName(d.name, "folder name"), parent: typeof d.parent === "string" && d.parent ? d.parent : null }
  })
  const seen = new Set<string>()
  for (const d of clean) {
    if (d.parent && !ids.has(d.parent)) throw new FolderError(400, `The parent of "${d.name}" is missing.`)
    const key = `${d.parent ?? ""}\u0000${d.name.toLowerCase()}`
    if (seen.has(key)) throw new FolderError(400, `Two folders in the same place are named "${d.name}".`)
    seen.add(key)
    if (ancestry(clean, d.id).length >= MAX_DEPTH) throw new FolderError(400, "Folders are nested too deeply.")
  }
  return flatten(buildTree(clean)).map(({ id, name, parent }) => ({ id, name, parent }))
}
