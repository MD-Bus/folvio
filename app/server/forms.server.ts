import { data } from "react-router"
import { HttpError } from "./util.server"

const mb = (value: FormDataEntryValue | null) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) : NaN
}

/** Collection settings posted by the dashboard's forms, in the shape `parseSettings` takes. */
export function settingsFromForm(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    quota: mb(form.get("quota_mb")),
    max_file: mb(form.get("max_file_mb")),
    expires: form.get("expires") ? Number(form.get("expires")) : null,
    upload: form.get("upload") === "on",
    create_folder: form.get("create_folder") === "on",
    rename_own: form.get("rename_own") === "on",
  }
  return out
}

/** A three-way permission select: "inherit" (null), "allow" or "deny". */
export function triState(value: FormDataEntryValue | null): boolean | null {
  return value === "allow" ? true : value === "deny" ? false : null
}

export type ActionResult = { ok?: boolean; intent?: string; error?: string; [key: string]: unknown }

/** Runs an action step and turns refusals (HttpError) into `{ error }` with their status, for the form to show. */
export async function attempt<T extends Record<string, unknown>>(intent: string, fn: () => Promise<T | void>) {
  try {
    const result = (await fn()) ?? {}
    return data<ActionResult>({ ok: true, intent, ...result })
  } catch (error) {
    if (error instanceof HttpError) return data<ActionResult>({ intent, error: error.message }, { status: error.status })
    if (error instanceof Error && error.message.includes("UNIQUE")) return data<ActionResult>({ intent, error: "A folder with that name already exists there." }, { status: 409 })
    throw error
  }
}
