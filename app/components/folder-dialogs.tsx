import { useEffect, useMemo, useState } from "react"
import { useFetcher } from "react-router"
import { FolderSelectOptions } from "#/components/file-browser"
import { FieldLabel } from "#/components/help-tip"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { NativeSelect } from "#/components/ui/native-select"
import { Switch } from "#/components/ui/switch"
import { PERMISSION_LABELS, PERMISSIONS, subtreeIds, type Permission } from "#/lib/folders"

type Folder = { id: string; parent: string | null; name: string; upload: number | null; create_folder: number | null; rename_own: number | null; hidden: number | boolean }

/** Closes `onDone` once the fetcher's action succeeded. */
function useDone(fetcher: ReturnType<typeof useFetcher<{ ok?: boolean; error?: string }>>, onDone: () => void) {
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data])
}

/** Creates a folder inside `parent` (null: the root). Posts `create_folder` to the page's action. */
export function NewFolderDialog({ open, onOpenChange, parentName, parent, note }: { open: boolean; onOpenChange: (open: boolean) => void; parentName: string; parent: string | null; note?: string }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  useDone(fetcher, () => onOpenChange(false))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>{note ?? `Inside ${parentName}.`}</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4" key={String(open)}>
          <input type="hidden" name="intent" value="create_folder" />
          <input type="hidden" name="parent" value={parent ?? ""} />
          <div className="grid gap-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input id="folder-name" name="name" required maxLength={180} autoFocus placeholder="Logos" />
          </div>
          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Creating..." : "Create folder"}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  )
}

const tri = (v: number | null) => (v === null || v === undefined ? "inherit" : v ? "allow" : "deny")

/** Rename, move, permission overrides, hiding and deletion of a folder (administrator). */
export function ManageFolderDialog({
  open,
  onOpenChange,
  folder,
  folders,
  rootLabel,
  inherited,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: Folder
  folders: Folder[]
  rootLabel: string
  /** What each permission would be without this folder's override (from the parent). */
  inherited: Record<Permission, boolean>
  onDeleted: () => void
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string; intent?: string }>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const exclude = useMemo(() => subtreeIds(folders, folder.id), [folders, folder.id])
  useDone(fetcher, () => {
    if (fetcher.data?.intent === "delete_folder") onDeleted()
    onOpenChange(false)
  })
  useEffect(() => {
    if (!open) setConfirmDelete(false)
  }, [open])
  const busy = fetcher.state !== "idle"

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage folder</DialogTitle>
          <DialogDescription>Changes apply at once to everyone with the link. Overrides apply to this folder and what is inside it.</DialogDescription>
        </DialogHeader>
        {confirmDelete ? (
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="delete_folder" />
            <input type="hidden" name="folder" value={folder.id} />
            <p className="text-sm">
              Delete <strong>{folder.name}</strong>? Only empty folders can be deleted (no subfolders, no files). Its folder links stop working.
            </p>
            {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                Back
              </Button>
              <Button type="submit" variant="destructive" disabled={busy}>
                {busy ? "Deleting..." : "Delete folder"}
              </Button>
            </DialogFooter>
          </fetcher.Form>
        ) : (
          <fetcher.Form method="post" className="grid gap-4" key={folder.id + String(open)}>
            <input type="hidden" name="intent" value="update_folder" />
            <input type="hidden" name="folder" value={folder.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="mf-name">Name</Label>
                <Input id="mf-name" name="name" defaultValue={folder.name} required maxLength={180} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mf-parent">Location</Label>
                <NativeSelect id="mf-parent" name="parent" defaultValue={folder.parent ?? ""}>
                  <FolderSelectOptions folders={folders} rootLabel={rootLabel} exclude={exclude} />
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Recipient permissions</p>
              {PERMISSIONS.filter((key) => key !== "create_folder").map((key) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <FieldLabel htmlFor={`mf-${key}`} help={key === "rename_own" ? "Recipients can only ever rename folders they created themselves." : undefined}>
                    {PERMISSION_LABELS[key]}
                  </FieldLabel>
                  <div className="w-44 shrink-0">
                    <NativeSelect id={`mf-${key}`} name={key} defaultValue={tri(folder[key])} className="h-8">
                      <option value="inherit">Inherit ({inherited[key] ? "allowed" : "denied"})</option>
                      <option value="allow">Allow</option>
                      <option value="deny">Deny</option>
                    </NativeSelect>
                  </div>
                </div>
              ))}
            </div>
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Hide from recipients</span>
                <span className="block text-xs text-muted-foreground">The folder and everything inside it disappear from the recipient page. You still see them.</span>
              </span>
              <Switch name="hidden" defaultChecked={!!folder.hidden} className="mt-0.5" />
            </label>
            {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                Delete folder
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving..." : "Save"}
                </Button>
              </div>
            </DialogFooter>
          </fetcher.Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
