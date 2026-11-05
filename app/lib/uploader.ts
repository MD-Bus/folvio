/**
 * Browser side of the upload protocol (see files.server.ts): reserve, send each part with PUT, complete. Parts are sent
 * with XMLHttpRequest for upload progress events. Each request carries the dashboard or recipient cookie.
 */
export type UploadState = "queued" | "uploading" | "done" | "error" | "cancelled"
export type UploadTask = { key: string; file: File; folder: string | null; folderName: string; loaded: number; state: UploadState; error?: string }

async function api<T>(url: string, method: string, data?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: data ? { "content-type": "application/json" } : {}, body: data ? JSON.stringify(data) : undefined, credentials: "same-origin" })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error || `The request failed (${response.status}).`)
  return body as T
}

function putPart(url: string, blob: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<{ partNumber: number; etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.responseType = "json"
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { error?: string; partNumber: number; etag: string }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body)
      else reject(new Error(body.error || `The upload failed (${xhr.status}).`))
    }
    xhr.onerror = () => reject(new Error("The connection was lost. Try again."))
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"))
    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(blob)
  })
}

/** Uploads one file into `folder` of the collection whose API base is `base` (e.g. /api/v1/collections/<id>). */
export async function uploadFile(base: string, file: File, folder: string | null, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<string> {
  const init = await api<{ id: string; parts: number; part_size: number }>(`${base}/uploads`, "POST", { name: file.name, size: file.size, folder })
  try {
    const parts: { partNumber: number; etag: string }[] = []
    for (let n = 1; n <= init.parts; n++) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
      const start = (n - 1) * init.part_size
      const blob = file.slice(start, Math.min(file.size, start + init.part_size))
      let attempt = 0
      for (;;) {
        try {
          parts.push(await putPart(`${base}/uploads/${init.id}/parts/${n}`, blob, (loaded) => onProgress(start + loaded), signal))
          break
        } catch (error) {
          // One retry per part for a dropped connection; refusals (4xx) are final.
          if (signal.aborted || ++attempt > 1 || !(error instanceof Error) || !error.message.startsWith("The connection")) throw error
        }
      }
      onProgress(Math.min(file.size, start + blob.size))
    }
    await api(`${base}/uploads/${init.id}/complete`, "POST", { parts })
    return init.id
  } catch (error) {
    await api(`${base}/uploads/${init.id}`, "DELETE").catch(() => {})
    throw error
  }
}
