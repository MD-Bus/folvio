import { File, FileArchive, FileAudio, FileImage, FileText, FileVideo } from "lucide-react"
import { fileKind } from "#/lib/format"

const ICONS = { image: FileImage, video: FileVideo, audio: FileAudio, archive: FileArchive, pdf: FileText, text: FileText, file: File }

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[fileKind(name)]
  return <Icon className={className} />
}
