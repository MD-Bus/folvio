import { useEffect, useMemo, useState } from "react"
import { Link, useFetcher } from "react-router"
import { Download, FolderInput, LayoutGrid, List, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react"
import { FileIcon } from "#/components/file-icon"
import { Ago } from "#/components/time"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "#/components/ui/dropdown-menu"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { NativeSelect } from "#/components/ui/native-select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { buildTree, flatten, folderPath } from "#/lib/folders"
import { canPreview, formatBytes } from "#/lib/format"
import { cn } from "#/lib/utils"

export type BrowserFile = { id: string; name: string; size: number; created: number; folder: string | null; uploader: "admin" | "recipient" }
type FolderOption = { id: string; parent: string | null; name: string }
type Dialogs = { kind: "rename"; file: BrowserFile } | { kind: "move"; ids: string[] } | { kind: "delete"; ids: string[] } | null

const VIEW_KEY = "folvio:file-view"

/** The folder choices of a select: the root, then every folder indented by depth. */
export function FolderSelectOptions({ folders, rootLabel, exclude }: { folders: FolderOption[]; rootLabel: string; exclude?: Set<string> }) {
  const rows = useMemo(() => flatten(buildTree(folders)).filter((f) => !exclude?.has(f.id)), [folders, exclude])
  return (
    <>
      <option value="">{rootLabel}</option>
      {rows.map((f) => (
        <option key={f.id} value={f.id}>
          {" ".repeat(f.depth + 1)}
          {f.name}
        </option>
      ))}
    </>
  )
}

/**
 * The administrator's view of the files of one folder (or of search results): grid with image previews or list,
 * selection, and rename / move / delete / download. Changes are posted to the page's action.
 */
export function FileBrowser({
  files: firstPage,
  next: firstNext,
  apiBase,
  folders,
  rootLabel,
  query,
  folder,
  recursive = false,
  toolbar,
  emptyText,
}: {
  files: BrowserFile[]
  next: string | null
  apiBase: string
  folders: FolderOption[]
  rootLabel: string
  query: string
  folder: string | null
  /** The files of the folder and of its subfolders: each file from a subfolder says where it is. */
  recursive?: boolean
  toolbar?: React.ReactNode
  emptyText?: string
}) {
  const [view, setView] = useState<"grid" | "list">("grid")
  const [more, setMore] = useState<BrowserFile[]>([])
  const [next, setNext] = useState(firstNext)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialogs>(null)
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  const busy = fetcher.state !== "idle"

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === "list" || saved === "grid") setView(saved)
    } catch {}
  }, [])
  // A new first page (another folder, a search, or a reload after a change) replaces what was loaded.
  useEffect(() => {
    setMore([])
    setNext(firstNext)
    setSelected((prev) => new Set([...prev].filter((id) => firstPage.some((f) => f.id === id))))
  }, [firstPage, firstNext])
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setDialog(null)
      setSelected(new Set())
    }
  }, [fetcher.state, fetcher.data])

  const files = useMemo(() => [...firstPage, ...more.filter((m) => !firstPage.some((f) => f.id === m.id))], [firstPage, more])
  const switchView = (v: "grid" | "list") => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {}
  }
  const toggle = (id: string) =>
    setSelected((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  const loadMore = async () => {
    if (!next) return
    setLoadingMore(true)
    try {
      const params = new URLSearchParams({ after: next })
      if (query) params.set("q", query)
      else if (folder) params.set("folder", folder)
      if (recursive) params.set("recursive", "1")
      const res = await fetch(`${apiBase}/files?${params}`)
      const page = (await res.json()) as { files: BrowserFile[]; next: string | null }
      if (res.ok) {
        setMore((m) => [...m, ...page.files])
        setNext(page.next)
      }
    } finally {
      setLoadingMore(false)
    }
  }
  const pathOf = (id: string | null) => (id ? folderPath(folders, id) : rootLabel)
  /** Where a file is, when it is not directly in the open folder (search results, or everything inside). */
  const placeOf = (f: BrowserFile) => (query || (recursive && f.folder !== folder) ? pathOf(f.folder) : null)
  const allSelected = files.length > 0 && files.every((f) => selected.has(f.id))

  const menu = (f: BrowserFile) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={`Actions for ${f.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`${apiBase}/files/${f.id}/download`} download>
            <Download /> Download
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDialog({ kind: "rename", file: f })}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDialog({ kind: "move", ids: [f.id] })}>
          <FolderInput /> Move
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: "delete", ids: [f.id] })}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-primary" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)))} disabled={!files.length} aria-label="Select all loaded files" />
          {selected.size ? `${selected.size} selected` : `${files.length}${next ? "+" : ""} file${files.length === 1 ? "" : "s"}`}
        </label>
        {selected.size > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "move", ids: [...selected] })}>
              <FolderInput /> Move
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDialog({ kind: "delete", ids: [...selected] })}>
              <Trash2 /> Delete
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
        {toolbar}
        <div className="flex rounded-md border p-0.5">
          <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon" className="size-7" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => switchView("grid")}>
            <LayoutGrid className="size-4" />
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="icon" className="size-7" aria-label="List view" aria-pressed={view === "list"} onClick={() => switchView("list")}>
            <List className="size-4" />
          </Button>
        </div>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          <Upload className="size-6" />
          {query ? `No file is named like "${query}".` : (emptyText ?? "No files in this folder yet.")}
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {files.map((f) => (
            <li key={f.id} className={cn("group relative overflow-hidden rounded-lg border bg-card transition-shadow", selected.has(f.id) && "ring-2 ring-primary")}>
              <div className="relative flex aspect-[4/3] items-center justify-center bg-muted/50">
                {canPreview(f.name, f.size) ? (
                  <img src={`${apiBase}/files/${f.id}/preview`} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <FileIcon name={f.name} className="size-10 text-muted-foreground" />
                )}
                <input
                  type="checkbox"
                  className={cn("absolute top-2 left-2 size-4 accent-primary transition-opacity", selected.size ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}
                  checked={selected.has(f.id)}
                  onChange={() => toggle(f.id)}
                  aria-label={`Select ${f.name}`}
                />
              </div>
              <div className="flex items-start gap-1 p-2.5">
                <div className="min-w-0 flex-1">
                  <a href={`${apiBase}/files/${f.id}/download`} download className="block truncate text-sm font-medium hover:underline" title={f.name}>
                    {f.name}
                  </a>
                  <div className="truncate text-xs text-muted-foreground">
                    {formatBytes(f.size)} · <Ago ts={f.created} />
                  </div>
                  {placeOf(f) && <div className="truncate text-xs text-muted-foreground">in {placeOf(f)}</div>}
                </div>
                {menu(f)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Size</TableHead>
                <TableHead className="hidden md:table-cell">Received</TableHead>
                <TableHead className="hidden lg:table-cell">From</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((f) => (
                <TableRow key={f.id} data-state={selected.has(f.id) ? "selected" : undefined}>
                  <TableCell>
                    <input type="checkbox" className="size-4 accent-primary" checked={selected.has(f.id)} onChange={() => toggle(f.id)} aria-label={`Select ${f.name}`} />
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    <div className="flex items-center gap-2">
                      <FileIcon name={f.name} className="size-4 shrink-0 text-muted-foreground" />
                      <a href={`${apiBase}/files/${f.id}/download`} download className="truncate font-medium hover:underline" title={f.name}>
                        {f.name}
                      </a>
                    </div>
                    {placeOf(f) && (
                      <Link to={`?folder=${f.folder ?? ""}`} className="ml-6 block truncate text-xs text-muted-foreground hover:underline">
                        {placeOf(f)}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">{formatBytes(f.size)}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    <Ago ts={f.created} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{f.uploader === "admin" ? "You" : "Recipient"}</TableCell>
                  <TableCell>{menu(f)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {next && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      <Dialog open={dialog?.kind === "rename"} onOpenChange={(open) => !open && !busy && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>Only the name changes; the contents stay as they are.</DialogDescription>
          </DialogHeader>
          {dialog?.kind === "rename" && (
            <fetcher.Form method="post" className="grid gap-4">
              <input type="hidden" name="intent" value="rename_file" />
              <input type="hidden" name="file" value={dialog.file.id} />
              <div className="grid gap-2">
                <Label htmlFor="file-name">Name</Label>
                <Input id="file-name" name="name" defaultValue={dialog.file.name} required maxLength={180} autoFocus />
              </div>
              {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving..." : "Rename"}
                </Button>
              </DialogFooter>
            </fetcher.Form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "move"} onOpenChange={(open) => !open && !busy && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {dialog?.kind === "move" && dialog.ids.length > 1 ? `${dialog.ids.length} files` : "file"}</DialogTitle>
            <DialogDescription>Choose the destination folder.</DialogDescription>
          </DialogHeader>
          {dialog?.kind === "move" && (
            <fetcher.Form method="post" className="grid gap-4">
              <input type="hidden" name="intent" value="move_files" />
              <input type="hidden" name="ids" value={dialog.ids.join(",")} />
              <div className="grid gap-2">
                <Label htmlFor="move-folder">Destination</Label>
                <NativeSelect id="move-folder" name="folder" defaultValue={folder ?? ""}>
                  <FolderSelectOptions folders={folders} rootLabel={rootLabel} />
                </NativeSelect>
              </div>
              {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Moving..." : "Move"}
                </Button>
              </DialogFooter>
            </fetcher.Form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialog?.kind === "delete"} onOpenChange={(open) => !open && !busy && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {dialog?.kind === "delete" && dialog.ids.length > 1 ? `${dialog.ids.length} files` : "this file"}?</DialogTitle>
            <DialogDescription>The stored contents are deleted from R2. This cannot be undone.</DialogDescription>
          </DialogHeader>
          {dialog?.kind === "delete" && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="delete_files" />
              <input type="hidden" name="ids" value={dialog.ids.join(",")} />
              {fetcher.data?.error && <p className="pb-3 text-sm text-destructive">{fetcher.data.error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={busy}>
                  {busy ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </fetcher.Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
