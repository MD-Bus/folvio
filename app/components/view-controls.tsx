import { useEffect, useState } from "react"
import { Image as ImageIcon, List } from "lucide-react"
import { Button } from "#/components/ui/button"

export type FileView = "list" | "grid"

/** Thumbnail width in pixels: the slider's range. */
export const TILE_MIN = 110
export const TILE_MAX = 360
const TILE_DEFAULT = 200

/**
 * The file view (list or image grid) and the thumbnail size, remembered in this browser under `key`. The first render
 * uses the defaults so server and browser agree; the saved choice applies right after.
 */
export function useFileView(key: string, initial: FileView): { view: FileView; setView: (v: FileView) => void; tile: number; setTile: (n: number) => void } {
  const [view, setViewState] = useState<FileView>(initial)
  const [tile, setTileState] = useState(TILE_DEFAULT)
  useEffect(() => {
    try {
      const v = localStorage.getItem(`folvio:${key}:view`)
      if (v === "list" || v === "grid") setViewState(v)
      const t = Number(localStorage.getItem(`folvio:${key}:tile`))
      if (t >= TILE_MIN && t <= TILE_MAX) setTileState(t)
    } catch {}
  }, [key])
  const save = (name: string, value: string) => {
    try {
      localStorage.setItem(`folvio:${key}:${name}`, value)
    } catch {}
  }
  return {
    view,
    setView: (v) => (setViewState(v), save("view", v)),
    tile,
    setTile: (n) => (setTileState(n), save("tile", String(n))),
  }
}

/** List / Images toggle, and in the image view a slider for the thumbnail size (smaller: more images per row). */
export function ViewControls({ view, setView, tile, setTile }: ReturnType<typeof useFileView>) {
  return (
    <div className="flex items-center gap-3">
      {view === "grid" && (
        <label className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <ImageIcon className="size-3" />
          <input
            type="range"
            min={TILE_MIN}
            max={TILE_MAX}
            step={10}
            value={tile}
            onChange={(e) => setTile(Number(e.target.value))}
            className="h-1 w-28 cursor-pointer accent-primary"
            aria-label="Thumbnail size"
          />
          <ImageIcon className="size-4" />
        </label>
      )}
      <div className="flex rounded-md border p-0.5" role="group" aria-label="View">
        <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5 px-2 text-xs" aria-pressed={view === "list"} onClick={() => setView("list")}>
          <List className="size-3.5" /> List
        </Button>
        <Button variant={view === "grid" ? "secondary" : "ghost"} size="sm" className="h-7 gap-1.5 px-2 text-xs" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
          <ImageIcon className="size-3.5" /> Images
        </Button>
      </div>
    </div>
  )
}

/** Grid style for the image view: as many columns of at least `tile` pixels as fit. */
export const gridStyle = (tile: number) => ({ gridTemplateColumns: `repeat(auto-fill, minmax(min(${tile}px, 100%), 1fr))` })
