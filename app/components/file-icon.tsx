import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo } from "lucide-react"
import { fileKind } from "#/lib/format"

const ICONS = { image: FileImage, video: FileVideo, audio: FileAudio, archive: FileArchive, pdf: FileText, text: FileText, file: File }

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[fileKind(name)]
  return <Icon className={className} />
}

/** The tile of a file without a picture preview: its kind's icon and its extension in large letters (ZIP, PDF, MP4...). */
export function FileTypeTile({ name }: { name: string }) {
  const dot = name.lastIndexOf(".")
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1).toUpperCase() : "FILE"
  return (
    <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
      <FileIcon name={name} className="size-9" />
      <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold tracking-wide shadow-xs ring-1 ring-border">{ext}</span>
    </div>
  )
}
