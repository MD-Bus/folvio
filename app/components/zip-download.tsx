import { useRef, useState } from "react"
import { FileArchive, Loader2 } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { formatBytes } from "#/lib/format"
import { ZipWriter, type ZipSink } from "#/lib/zip-writer"

type Entry = { path: string; id?: string; size: number; created?: number }
type Manifest = { name: string; entries: Entry[]; files: number; bytes: number }
type State = { phase: "listing" | "zipping" | "saving" | "done" | "error" | "cancelled"; name: string; files: number; bytes: number; doneFiles: number; doneBytes: number; current?: string; error?: string }

/** Above this size the archive is written straight to disk where the browser can (Chrome, Edge), not built in memory. */
const DISK_THRESHOLD = 500_000_000

type SaveHandle = { createWritable: () => Promise<{ write: (c: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> }
type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim() || "folder"

/**
 * Downloads a folder (null: the whole collection) as a ZIP with its subfolders. The browser builds the archive: the
 * Worker only lists the files and streams each one, so it stays within the free plan's CPU limit whatever the size.
 */
export function ZipDownloadButton({ apiBase, folder, label, size = "sm", variant = "outline" }: { apiBase: string; folder: string | null; label: string; size?: "sm" | "default"; variant?: "outline" | "ghost" }) {
  const [state, setState] = useState<State | null>(null)
  const abort = useRef<AbortController | null>(null)

  const start = async () => {
    const controller = new AbortController()
    abort.current = controller
    setState({ phase: "listing", name: label, files: 0, bytes: 0, doneFiles: 0, doneBytes: 0 })
    let cleanup: (() => Promise<void>) | null = null
    try {
      const res = await fetch(`${apiBase}/archive?folder=${encodeURIComponent(folder ?? "")}`, { signal: controller.signal })
      const manifest = (await res.json()) as Manifest & { error?: string }
      if (!res.ok) throw new Error(manifest.error || "The folder could not be listed.")
      const fileName = `${safeName(manifest.name)}.zip`
      setState((s) => s && { ...s, phase: "zipping", name: manifest.name, files: manifest.files, bytes: manifest.bytes })

      // Where the archive goes: straight to a file for large folders when the browser allows it, otherwise memory.
      let sink: ZipSink
      let chunks: Uint8Array[] | null = null
      const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
      if (manifest.bytes > DISK_THRESHOLD && picker) {
        const handle = await picker({ suggestedName: fileName, types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] })
        const writable = await handle.createWritable()
        sink = { write: (c) => writable.write(c), close: () => writable.close() }
        cleanup = () => writable.abort().catch(() => {})
      } else {
        chunks = []
        const list = chunks
        sink = { write: (c) => void list.push(c), close: () => {} }
      }

      const zip = new ZipWriter(sink)
      let doneFiles = 0
      let doneBytes = 0
      // Progress is drawn at most every 150 ms: updating on every chunk made the dialog flicker.
      let drawn = 0
      const draw = (force = false) => {
        const now = performance.now()
        if (!force && now - drawn < 150) return
        drawn = now
        setState((s) => s && { ...s, doneBytes, doneFiles })
      }
      for (const entry of manifest.entries) {
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError")
        const at = entry.created ? new Date(entry.created) : new Date()
        if (!entry.id) {
          await zip.addDirectory(entry.path, at)
          continue
        }
        setState((s) => s && { ...s, current: entry.path })
        const file = await fetch(`${apiBase}/files/${entry.id}/download`, { signal: controller.signal })
        if (!file.ok || !file.body) throw new Error(`${entry.path} could not be downloaded (${file.status}).`)
        await zip.addFile(entry.path, file.body, at, (n) => {
          doneBytes += n
          draw()
        })
        doneFiles++
        draw(true)
      }
      setState((s) => s && { ...s, phase: "saving", current: undefined })
      await zip.finish()
      cleanup = null
      if (chunks) {
        const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "application/zip" }))
        const a = document.createElement("a")
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      }
      setState((s) => s && { ...s, phase: "done" })
    } catch (error) {
      await cleanup?.()
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      setState((s) => s && { ...s, phase: cancelled ? "cancelled" : "error", error: cancelled ? undefined : error instanceof Error ? error.message : String(error) })
    }
  }

  const busy = state && (state.phase === "listing" || state.phase === "zipping" || state.phase === "saving")
  const pct = state && state.bytes ? Math.min(100, Math.round((state.doneBytes / state.bytes) * 100)) : 0

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={start} disabled={Boolean(busy)}>
        <FileArchive /> {folder ? "Download ZIP" : "Download all as ZIP"}
      </Button>
      <Dialog open={state !== null} onOpenChange={(open) => !open && (busy ? abort.current?.abort() : setState(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">{state?.phase === "done" ? "ZIP ready" : `ZIP of ${state?.name ?? label}`}</DialogTitle>
            <DialogDescription>
              {state?.phase === "listing" && "Listing the files..."}
              {state?.phase === "zipping" && "Your browser is building the archive with every subfolder. Keep this tab open."}
              {state?.phase === "saving" && "Finishing the archive..."}
              {state?.phase === "done" && `${state.files} file${state.files === 1 ? "" : "s"} (${formatBytes(state.bytes)}) saved to your downloads.`}
              {state?.phase === "cancelled" && "Cancelled. Nothing was saved."}
              {state?.phase === "error" && <span className="text-destructive">{state.error}</span>}
            </DialogDescription>
          </DialogHeader>
          {state && (state.phase === "zipping" || state.phase === "saving") && (
            <div className="min-w-0 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-150 ease-linear" style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                <span>
                  {state.doneFiles} of {state.files} files
                </span>
                <span>
                  {formatBytes(state.doneBytes)} of {formatBytes(state.bytes)}
                </span>
              </div>
              <p className="flex h-4 min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={state.current}>
                {state.current && (
                  <>
                    <Loader2 className="size-3 shrink-0 animate-spin" />
                    <span className="min-w-0 truncate">{state.current.split("/").pop()}</span>
                  </>
                )}
                {state.phase === "saving" && "Saving..."}
              </p>
            </div>
          )}
          <DialogFooter>
            {busy ? (
              <Button variant="outline" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            ) : (
              <Button onClick={() => setState(null)}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
