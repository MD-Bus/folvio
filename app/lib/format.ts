/** 1.2 GB, 34.5 MB, 812 KB, 12 B (decimal units, as Cloudflare bills storage). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B"
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)} TB`
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`
  return `${n} B`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i

/** Raster images up to 10 MB are previewed in the dashboard. SVG and HTML never are (they can run scripts). */
export const PREVIEW_MAX_BYTES = 10_000_000
export const canPreview = (name: string, size: number) => IMAGE.test(name) && size <= PREVIEW_MAX_BYTES

export const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" }

/** A rough kind of file for its icon. */
export function fileKind(name: string): "image" | "video" | "audio" | "archive" | "pdf" | "text" | "file" {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (/^(png|jpe?g|gif|webp|avif|svg|heic|tiff?|bmp|psd|ai)$/.test(ext)) return "image"
  if (/^(mp4|mov|webm|mkv|avi|m4v)$/.test(ext)) return "video"
  if (/^(mp3|wav|flac|aac|m4a|ogg)$/.test(ext)) return "audio"
  if (/^(zip|rar|7z|tar|gz|tgz|bz2|xz)$/.test(ext)) return "archive"
  if (ext === "pdf") return "pdf"
  if (/^(txt|md|csv|json|docx?|xlsx?|pptx?|rtf|odt|pages|key|numbers)$/.test(ext)) return "text"
  return "file"
}

/** Value for a datetime-local input, in the browser's time zone. */
export function toLocalInput(ts: number | null): string {
  if (!ts) return ""
  const d = new Date(ts)
  return new Date(ts - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** Part size of uploads: the browser sends each file in parts of this size, each streamed by the Worker into R2. */
export const PART_SIZE = 16 * 1024 * 1024

export function compactNumber(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${+(n / 1_000_000).toFixed(1)}M`
}
