import { useRef, useState } from "react"
import { Form, redirect, useActionData, useNavigation } from "react-router"
import { ArrowLeft, ArrowRight, Check } from "lucide-react"
import type { Route } from "./+types/collections.new"
import { DEFAULT_SETTINGS, DetailsFields, ExpiryField, LimitFields, PermissionFields } from "#/components/collection-fields"
import { DraftFolders } from "#/components/draft-folders"
import { FieldLabel } from "#/components/help-tip"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { formatBytes } from "#/lib/format"
import { cn } from "#/lib/utils"
import { requireAuth } from "~/server/auth.server"
import { createCollection } from "~/server/collections.server"
import { storageLimit } from "~/server/db.server"
import { settingsFromForm } from "~/server/forms.server"
import { safeJsonParse, HttpError } from "~/server/util.server"

export const meta: Route.MetaFunction = () => [{ title: "New collection | Folvio" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  return { storageLimit: storageLimit(env) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  try {
    const created = await createCollection(env, { ...settingsFromForm(form), password: String(form.get("password") ?? "") }, safeJsonParse(String(form.get("folders") ?? "[]"), []))
    return redirect(`/collections/${created.id}?created=1`)
  } catch (error) {
    if (error instanceof HttpError) return { error: error.message }
    if (error instanceof Error && error.message.includes("UNIQUE")) return { error: "Two folders in the same place have the same name." }
    throw error
  }
}

const STEPS = [
  { id: "details", label: "Details" },
  { id: "access", label: "Access and limits" },
  { id: "folders", label: "Folders" },
  { id: "permissions", label: "Permissions" },
  { id: "review", label: "Review" },
] as const

type Review = { name: string; password: boolean; expires: string; quota: string; maxFile: string; folders: number; upload: boolean; createFolder: boolean; renameOwn: boolean }

export default function NewCollection({ loaderData }: Route.ComponentProps) {
  const { storageLimit } = loaderData
  const actionData = useActionData<typeof action>()
  const busy = useNavigation().state !== "idle"
  const [step, setStep] = useState(0)
  const [review, setReview] = useState<Review | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const values = { ...DEFAULT_SETTINGS, quota: Math.min(DEFAULT_SETTINGS.quota, storageLimit) }

  /** Moves on only when the fields of the current step are valid. */
  const go = (next: number) => {
    const form = formRef.current
    if (!form) return
    if (next > step) {
      const panel = form.querySelector<HTMLElement>(`[data-step="${step}"]`)
      const invalid = panel ? [...panel.querySelectorAll<HTMLInputElement>("input, textarea, select")].find((el) => !el.checkValidity()) : undefined
      if (invalid) return invalid.reportValidity()
    }
    if (next === STEPS.length - 1) {
      const d = new FormData(form)
      const expires = Number(d.get("expires"))
      setReview({
        name: String(d.get("name") ?? ""),
        password: Boolean(d.get("password")),
        expires: expires ? new Date(expires).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Never",
        quota: formatBytes(Number(d.get("quota_mb")) * 1e6),
        maxFile: formatBytes(Number(d.get("max_file_mb")) * 1e6),
        folders: JSON.parse(String(d.get("folders") ?? "[]")).length,
        upload: d.get("upload") === "on",
        createFolder: d.get("create_folder") === "on",
        renameOwn: d.get("rename_own") === "on",
      })
    }
    setStep(next)
  }

  return (
    <>
      <PageHeader crumbs={[{ label: "Collections", to: "/collections" }, { label: "New collection" }]} />
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 pt-0 lg:px-6">
        <PageTitle title="New collection" description="Five short steps. Everything can be changed later without changing the link." />

        <ol className="grid grid-cols-5 gap-2" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => i < step && go(i)}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                className={cn("w-full space-y-1.5 text-left text-xs disabled:cursor-default", i <= step ? "text-foreground" : "text-muted-foreground")}
              >
                <span className={cn("block h-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
                <span className="hidden sm:block">
                  {i + 1}. {s.label}
                </span>
              </button>
            </li>
          ))}
        </ol>

        <Form ref={formRef} method="post" className="space-y-6" onKeyDown={(e) => {
            if (e.key === "Enter" && !e.defaultPrevented && (e.target as HTMLElement).tagName === "INPUT" && step < STEPS.length - 1) {
              e.preventDefault()
              go(step + 1)
            }
          }}>
          <section data-step={0} hidden={step !== 0} className="space-y-4">
            <h2 className="text-lg font-semibold">Details</h2>
            <DetailsFields values={values} />
          </section>

          <section data-step={1} hidden={step !== 1} className="space-y-5">
            <h2 className="text-lg font-semibold">Access and limits</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabel htmlFor="password" help="Recipients must enter it once per browser. Leave empty to let anyone with the link in.">
                  Password (optional)
                </FieldLabel>
                <Input id="password" name="password" type="password" autoComplete="new-password" maxLength={200} />
              </div>
              <ExpiryField value={null} />
            </div>
            <LimitFields values={values} storageLimit={storageLimit} />
          </section>

          <section data-step={2} hidden={step !== 2} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Folders</h2>
              <p className="text-sm text-muted-foreground">Prepare the folders recipients will see, so every file lands in the right place.</p>
            </div>
            <DraftFolders />
          </section>

          <section data-step={3} hidden={step !== 3} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Permissions</h2>
              <p className="text-sm text-muted-foreground">What recipients may do. Each folder can override these later, or be hidden.</p>
            </div>
            <PermissionFields values={values} />
          </section>

          <section data-step={4} hidden={step !== 4} className="space-y-4">
            <h2 className="text-lg font-semibold">Review</h2>
            {review && (
              <dl className="divide-y rounded-lg border bg-card text-sm">
                {[
                  ["Name", review.name],
                  ["Password", review.password ? "Required" : "None, the link is enough"],
                  ["Expires", review.expires],
                  ["Storage limit", review.quota],
                  ["Maximum file size", review.maxFile],
                  ["Folders", review.folders ? `${review.folders} prepared` : "None"],
                  ["Uploads", review.upload ? "Accepted" : "Closed"],
                  ["Recipients create folders", review.createFolder ? "Yes" : "No"],
                  ["Recipients rename their folders", review.renameOwn ? "Yes" : "No"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-sm text-muted-foreground">After creating it you get the link to share.</p>
          </section>

          {actionData?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionData.error}</div>}

          <div className="flex justify-between gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => go(step - 1)} disabled={step === 0}>
              <ArrowLeft /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button key="continue" type="button" onClick={() => go(step + 1)}>
                Continue <ArrowRight />
              </Button>
            ) : (
              <Button key="create" type="submit" disabled={busy}>
                <Check /> {busy ? "Creating..." : "Create collection"}
              </Button>
            )}
          </div>
        </Form>
      </div>
    </>
  )
}
