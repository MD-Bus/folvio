import { useRef, useState } from "react"
import { CircleAlert, CircleCheck, CloudUpload, Loader2, X } from "lucide-react"
import { Button } from "#/components/ui/button"
import { formatBytes } from "#/lib/format"
import type { UploadTask } from "#/lib/uploader"
import { cn } from "#/lib/utils"

/** A drop area and a file picker. Dropping anywhere on it, or choosing files, queues them for the current folder. */
export function DropZone({ onFiles, disabled, hint, compact }: { onFiles: (files: FileList) => void; disabled?: boolean; hint: React.ReactNode; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center transition-colors",
        compact ? "flex-row gap-3 px-4 py-3 text-left" : "px-6 py-8",
        over ? "border-primary bg-primary/5" : "bg-muted/30",
        disabled && "opacity-60",
      )}
    >
      <CloudUpload className={cn("shrink-0 text-muted-foreground", compact ? "size-5" : "size-8")} />
      <div className={cn("min-w-0 text-sm", compact && "flex-1")}>
        <p className="font-medium">{disabled ? "Uploads are closed here" : "Drop files here"}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
        Choose files
      </Button>
    </div>
  )
}

/** The files being sent, with progress, errors and cancel. */
export function UploadList({ tasks, onCancel, onClear }: { tasks: UploadTask[]; onCancel: (key: string) => void; onClear: () => void }) {
  if (tasks.length === 0) return null
  const finished = tasks.filter((t) => t.state !== "queued" && t.state !== "uploading").length
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
        <span className="font-medium">
          Uploads <span className="text-muted-foreground tabular-nums">{finished} of {tasks.length} finished</span>
        </span>
        {finished > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onClear}>
            Clear finished
          </Button>
        )}
      </div>
      <ul className="max-h-72 divide-y overflow-y-auto">
        {tasks.map((t) => {
          const pct = t.file.size ? Math.round((t.loaded / t.file.size) * 100) : 0
          return (
            <li key={t.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {t.state === "done" ? (
                <CircleCheck className="size-4 shrink-0 text-green-600" />
              ) : t.state === "error" ? (
                <CircleAlert className="size-4 shrink-0 text-destructive" />
              ) : t.state === "uploading" ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <CloudUpload className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{t.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t.state === "uploading" ? `${pct}% of ${formatBytes(t.file.size)}` : t.state === "done" ? formatBytes(t.file.size) : t.state === "queued" ? "Waiting" : t.state === "cancelled" ? "Cancelled" : "Failed"}
                  </span>
                </div>
                {t.state === "uploading" && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="truncate text-xs text-muted-foreground">{t.state === "error" ? <span className="text-destructive">{t.error}</span> : `To ${t.folderName}`}</div>
              </div>
              {(t.state === "uploading" || t.state === "queued") && (
                <Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label={`Cancel ${t.file.name}`} onClick={() => onCancel(t.key)}>
                  <X className="size-4" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
