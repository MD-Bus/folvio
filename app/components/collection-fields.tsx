import { useState } from "react"
import { FieldLabel } from "#/components/help-tip"
import { Input } from "#/components/ui/input"
import { Switch } from "#/components/ui/switch"
import { Textarea } from "#/components/ui/textarea"
import { toLocalInput } from "#/lib/format"

export type SettingsValues = { name: string; description: string; expires: number | null; quota: number; max_file: number; upload: boolean; create_folder: boolean; rename_own: boolean }

export const DEFAULT_SETTINGS: SettingsValues = { name: "", description: "", expires: null, quota: 1_000_000_000, max_file: 100_000_000, upload: true, create_folder: false, rename_own: false }

/** Name and description. */
export function DetailsFields({ values }: { values: SettingsValues }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <FieldLabel htmlFor="name" help="Shown to recipients at the top of the collection page.">
          Collection name
        </FieldLabel>
        <Input id="name" name="name" required maxLength={180} defaultValue={values.name} placeholder="Harbor Studio website" autoFocus />
      </div>
      <div className="grid gap-2">
        <FieldLabel htmlFor="description" help="Instructions for recipients: what to send and where. Shown under the name.">
          Description
        </FieldLabel>
        <Textarea id="description" name="description" maxLength={2000} rows={4} defaultValue={values.description} placeholder="Please upload your logos, brand guidelines and photos for the new website." />
      </div>
    </div>
  )
}

/** The expiry as a local date and time; the hidden field holds Unix milliseconds (the server does not know the browser's time zone). */
export function ExpiryField({ value }: { value: number | null }) {
  const [ms, setMs] = useState<number | null>(value)
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor="expires-local" help="After this moment the link stops working for recipients. Leave empty for no expiry. Files already received stay.">
        Expires
      </FieldLabel>
      <Input
        id="expires-local"
        type="datetime-local"
        defaultValue={toLocalInput(value)}
        onChange={(e) => {
          const t = e.target.value ? new Date(e.target.value).getTime() : NaN
          setMs(Number.isFinite(t) ? t : null)
        }}
      />
      <input type="hidden" name="expires" value={ms ?? ""} />
    </div>
  )
}

/** Storage limit and maximum file size, in MB. */
export function LimitFields({ values, storageLimit }: { values: SettingsValues; storageLimit: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="grid gap-2">
        <FieldLabel htmlFor="quota_mb" help={`Total size this collection may hold, uploads in progress included. At most ${Math.floor(storageLimit / 1e6).toLocaleString("en-GB")} MB (the installation's STORAGE_LIMIT_BYTES).`}>
          Storage limit (MB)
        </FieldLabel>
        <Input id="quota_mb" name="quota_mb" type="number" min={1} max={Math.floor(storageLimit / 1e6)} step="any" required defaultValue={values.quota / 1e6} />
      </div>
      <div className="grid gap-2">
        <FieldLabel htmlFor="max_file_mb" help="Larger files are refused before they are sent. At most 2,000 MB.">
          Maximum file size (MB)
        </FieldLabel>
        <Input id="max_file_mb" name="max_file_mb" type="number" min={1} max={2000} step="any" required defaultValue={values.max_file / 1e6} />
      </div>
    </div>
  )
}

export function SwitchRow({ name, label, description, defaultChecked }: { name: string; label: string; description: React.ReactNode; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-card p-4">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch name={name} defaultChecked={defaultChecked} className="mt-0.5" />
    </label>
  )
}

/** What recipients may do everywhere in the collection, unless a folder overrides it. */
export function PermissionFields({ values }: { values: SettingsValues }) {
  return (
    <div className="grid gap-3">
      <SwitchRow name="upload" label="Accept uploads" description="Recipients can upload files into the folders they see. Turn off to close the collection without deleting anything." defaultChecked={values.upload} />
      <SwitchRow name="create_folder" label="Recipients can create folders" description="Off by default, so files land in the structure you prepared." defaultChecked={values.create_folder} />
      <SwitchRow name="rename_own" label="Recipients can rename their own folders" description="Only folders they created themselves, from the same browser. Recipients can never move or delete folders." defaultChecked={values.rename_own} />
    </div>
  )
}
