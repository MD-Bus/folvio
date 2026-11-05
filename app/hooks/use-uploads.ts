import { useCallback, useEffect, useRef, useState } from "react"
import { uploadFile, type UploadTask } from "#/lib/uploader"

/**
 * A queue of uploads into one collection, sent one file at a time. `onUploaded` runs after each file arrives (for
 * example to reload the file list). Leaving the page while files are uploading asks for confirmation.
 */
export function useUploads(base: string, onUploaded: () => void, maxFile: number) {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const running = useRef(false)
  const controllers = useRef(new Map<string, AbortController>())
  const queue = useRef<UploadTask[]>([])
  const uploaded = useRef(onUploaded)
  uploaded.current = onUploaded

  const update = (key: string, patch: Partial<UploadTask>) => setTasks((list) => list.map((t) => (t.key === key ? { ...t, ...patch } : t)))

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      while (queue.current.length) {
        const task = queue.current.shift()!
        const controller = new AbortController()
        controllers.current.set(task.key, controller)
        update(task.key, { state: "uploading" })
        try {
          await uploadFile(base, task.file, task.folder, (loaded) => update(task.key, { loaded }), controller.signal)
          update(task.key, { state: "done", loaded: task.file.size })
          uploaded.current()
        } catch (error) {
          if (controller.signal.aborted) update(task.key, { state: "cancelled" })
          else update(task.key, { state: "error", error: error instanceof Error ? error.message : String(error) })
        } finally {
          controllers.current.delete(task.key)
        }
      }
    } finally {
      running.current = false
    }
  }, [base])

  const add = useCallback(
    (files: FileList | File[], folder: string | null, folderName: string) => {
      const added: UploadTask[] = [...files].map((file) => {
        const task: UploadTask = { key: `${Date.now()}-${Math.random()}`, file, folder, folderName, loaded: 0, state: "queued" }
        if (file.size === 0) return { ...task, state: "error", error: "Empty files cannot be uploaded." }
        if (file.size > maxFile) return { ...task, state: "error", error: "Larger than the maximum file size of this collection." }
        return task
      })
      setTasks((list) => [...list, ...added])
      queue.current.push(...added.filter((t) => t.state === "queued"))
      void pump()
    },
    [pump, maxFile],
  )

  const cancel = (key: string) => {
    const controller = controllers.current.get(key)
    if (controller) controller.abort()
    else {
      queue.current = queue.current.filter((t) => t.key !== key)
      update(key, { state: "cancelled" })
    }
  }
  const clear = () => setTasks((list) => list.filter((t) => t.state === "queued" || t.state === "uploading"))
  const busy = tasks.some((t) => t.state === "queued" || t.state === "uploading")

  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [busy])

  return { tasks, add, cancel, clear, busy }
}
