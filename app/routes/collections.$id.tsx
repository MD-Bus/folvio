import { useEffect, useMemo, useState } from "react"
import { data, Form, Link, redirect, useFetcher, useNavigation, useRevalidator, useSearchParams } from "react-router"
import { EyeOff, FolderCog, FolderPlus, KeyRound, Link2, Plus, Search, Settings2, Share2, Trash2, X } from "lucide-react"
import type { Route } from "./+types/collections.$id"
import { AgentHelp } from "#/components/agent-help"
import { CollectionStateBadge } from "#/components/collection-state"
import { DetailsFields, ExpiryField, LimitFields, PermissionFields, type SettingsValues } from "#/components/collection-fields"
import { CopyLink } from "#/components/copy-link"
import { Fact, FactStrip } from "#/components/fact-strip"
import { FileBrowser, FolderSelectOptions } from "#/components/file-browser"
import { ManageFolderDialog, NewFolderDialog } from "#/components/folder-dialogs"
import { FolderTree } from "#/components/folder-tree"
import { FolderCards, ScopeSwitch } from "#/components/folder-cards"
import { FieldLabel } from "#/components/help-tip"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { onlyTabChanged, RouteTabs, useRouteTab } from "#/components/route-tabs"
import { Ago, When } from "#/components/time"
import { DropZone, UploadList } from "#/components/upload-panel"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { NativeSelect } from "#/components/ui/native-select"
import { Switch } from "#/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { useUploads } from "#/hooks/use-uploads"
import { effectivePermissions, folderPath, PERMISSIONS, type FolderRow } from "#/lib/folders"
import { formatBytes, plural } from "#/lib/format"
import { requireAuth } from "~/server/auth.server"
import { collectionSummary, createFolder, deleteCollection, deleteFolder, regenerateToken, updateCollection, updateFolder, visibleFolders } from "~/server/collections.server"
import { storageLimit } from "~/server/db.server"
import { deleteFiles, folderCounts, getFile, listFiles, updateFiles } from "~/server/files.server"
import { attempt, settingsFromForm, triState } from "~/server/forms.server"
import { adminAccess, createLink, listLinks, revokeLink } from "~/server/share.server"
import { HttpError } from "~/server/util.server"

export const meta: Route.MetaFunction = ({ data }) => [{ title: `${data?.collection.name ?? "Collection"} | Folvio` }]

export function shouldRevalidate(args: Parameters<typeof onlyTabChanged>[0] & { defaultShouldRevalidate: boolean }) {
  return onlyTabChanged(args) ? false : args.defaultShouldRevalidate
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const url = new URL(request.url)
  let access
  try {
    access = await adminAccess(env, params.id)
  } catch (error) {
    if (error instanceof HttpError) throw data("Collection not found.", { status: 404 })
    throw error
  }
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100)
  let folder = url.searchParams.get("folder") || null
  if (folder && !access.folders.some((f) => f.id === folder)) folder = null
  // By default a folder shows everything inside it, subfolders included, so the root is never empty when files sit deeper.
  const scope = url.searchParams.get("scope") === "here" ? ("here" as const) : ("all" as const)
  const [summary, usage, links, page] = await Promise.all([collectionSummary(env, access.c.id), folderCounts(env, access), listLinks(env, access.c.id), listFiles(env, access, { folder, q, recursive: scope === "all" })])
  const { password, revision, folder_root, ...c } = access.c
  return {
    collection: { ...c, password_set: !!password },
    summary: summary!,
    folders: visibleFolders(access),
    usage,
    links,
    files: page.files,
    next: page.next,
    folder,
    q,
    scope,
    origin: url.origin,
    storageLimit: storageLimit(env),
    now: Date.now(),
  }
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  const intent = String(form.get("intent") ?? "")
  const access = await adminAccess(env, params.id)
  const ids = () => String(form.get("ids") ?? "").split(",").filter(Boolean)

  if (intent === "delete_collection") {
    if (String(form.get("confirm") ?? "").trim() !== access.c.name) return data({ intent, error: "Type the collection's name to confirm." }, { status: 400 })
    await deleteCollection(env, access.c)
    return redirect("/collections")
  }

  return attempt(intent, async () => {
    switch (intent) {
      case "create_folder":
        return { id: await createFolder(env, access, { name: form.get("name"), parent: String(form.get("parent") ?? "") || null }) }
      case "update_folder": {
        const patch: Record<string, unknown> = { name: form.get("name"), parent: String(form.get("parent") ?? "") || null, hidden: form.get("hidden") === "on" }
        for (const key of PERMISSIONS) patch[key] = triState(form.get(key))
        return void (await updateFolder(env, access, String(form.get("folder")), patch))
      }
      case "delete_folder":
        return void (await deleteFolder(env, access, String(form.get("folder"))))
      case "rename_file": {
        const file = await getFile(env, access, String(form.get("file")))
        return void (await updateFiles(env, access, [file.id], { name: form.get("name") }))
      }
      case "move_files":
        return { moved: await updateFiles(env, access, ids(), { folder: String(form.get("folder") ?? "") || null }) }
      case "delete_files":
        return { deleted: await deleteFiles(env, access, ids()) }
      case "create_link":
        return { link: await createLink(env, access, String(form.get("folder") ?? "")) }
      case "revoke_link":
        return void (await revokeLink(env, access.c.id, String(form.get("token"))))
      case "regenerate_token":
        return { token: await regenerateToken(env, access.c) }
      case "settings": {
        const input = settingsFromForm(form)
        if (form.get("remove_password") === "on") input.password = ""
        else if (form.get("password")) input.password = String(form.get("password"))
        return void (await updateCollection(env, access.c, input))
      }
      default:
        throw new HttpError(400, "Unknown action.")
    }
  })
}

export default function CollectionPage({ loaderData }: Route.ComponentProps) {
  const { collection: c, summary, folders, usage, links, files, next, folder, q, scope, origin, storageLimit, now } = loaderData
  const [params] = useSearchParams()
  const [tab, setTab] = useRouteTab(["files", "links", "settings"])
  const [shareOpen, setShareOpen] = useState(false)
  const [created, setCreated] = useState(params.get("created") === "1")
  const shareUrl = `${origin}/s/${c.token}`
  const pct = Math.min(100, Math.round((summary.bytes / c.quota) * 100))

  useEffect(() => {
    if (params.get("created") === "1") window.history.replaceState(null, "", `/collections/${c.id}`)
  }, [params, c.id])

  return (
    <>
      <PageHeader crumbs={[{ label: "Collections", to: "/collections" }, { label: c.name }]} />
      <div className="space-y-6 p-4 pt-0 lg:px-6">
        <PageTitle
          title={c.name}
          badge={<CollectionStateBadge c={c} now={now} />}
          description={c.description || undefined}
          actions={
            <>
              <Button variant="outline" asChild>
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  Open recipient page
                </a>
              </Button>
              <Button onClick={() => setShareOpen(true)}>
                <Share2 /> Share
              </Button>
            </>
          }
        />

        {created && (
          <Alert>
            <Share2 />
            <AlertTitle>Your collection is ready. Share this link</AlertTitle>
            <AlertDescription className="w-full space-y-2">
              <p>Recipients see the folders you prepared and upload where you allow it.{c.password_set ? " They need the password you set." : ""}</p>
              <CopyLink url={shareUrl} label="Collection link" />
              <Button size="sm" variant="outline" onClick={() => setCreated(false)}>
                Done
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <FactStrip>
          <Fact label="Files" value={summary.files.toLocaleString("en-GB")} detail={summary.last_upload ? <>Last <Ago ts={summary.last_upload} /></> : "Nothing received yet"} />
          <Fact label="Storage" value={formatBytes(summary.bytes)} detail={`${pct}% of ${formatBytes(c.quota)}`} tone={pct >= 90 ? "danger" : pct >= 75 ? "warning" : "default"} />
          <Fact
            label="Access"
            value={c.password_set ? "Password" : "Link only"}
            detail={c.expires ? <>{c.auto_delete ? (c.expires < now ? "Being deleted" : "Deleted") : c.expires < now ? "Expired" : "Expires"} <Ago ts={c.expires} /></> : "Never expires"}
            tone={c.expires && c.expires < now ? "danger" : c.auto_delete ? "warning" : "default"}
            help={c.auto_delete ? "This collection deletes itself, with all its files, at its expiry date. Change it in Settings." : undefined}
          />
          <Fact label="Folders" value={summary.folders} detail={`${plural(links.length, "folder link")}`} />
        </FactStrip>

        <RouteTabs
          tabs={[
            { id: "files", label: "Files and folders" },
            { id: "links", label: "Share links", count: links.length + 1 },
            { id: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "files" && <FilesTab key={c.id} collection={c} folders={folders} usage={usage} files={files} next={next} folder={folder} q={q} scope={scope} />}
        {tab === "links" && <LinksTab collection={c} folders={folders} links={links} origin={origin} />}
        {tab === "settings" && <SettingsTab collection={c} storageLimit={storageLimit} />}
      </div>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Share {c.name}</DialogTitle>
            <DialogDescription>Anyone with this link {c.password_set ? "and the password " : ""}can open the collection and upload where you allow it. To share only one folder, create a folder link.</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <CopyLink url={shareUrl} label="Collection link" />
            <AgentHelp link={shareUrl} password={c.password_set} collapsible />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShareOpen(false)
                setTab("links")
              }}
            >
              <Link2 /> Folder links
            </Button>
            <Button onClick={() => setShareOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type Data = Route.ComponentProps["loaderData"]

/** The deepest first folder, for a realistic example path. */
function flattenFirst(folders: { id: string; parent: string | null; name: string }[]): string {
  let current = [...folders].filter((f) => f.parent === null).sort((a, b) => a.name.localeCompare(b.name))[0]
  for (;;) {
    const child = folders.filter((f) => f.parent === current.id).sort((a, b) => a.name.localeCompare(b.name))[0]
    if (!child) return current.id
    current = child
  }
}

function FilesTab({ collection: c, folders, usage, files, next, folder, q, scope }: Pick<Data, "folders" | "usage" | "files" | "next" | "folder" | "q" | "scope"> & { collection: Data["collection"] }) {
  const [params, setParams] = useSearchParams()
  const revalidator = useRevalidator()
  const navigation = useNavigation()
  const [newFolder, setNewFolder] = useState(false)
  const [manage, setManage] = useState(false)
  const apiBase = `/api/v1/collections/${c.id}`
  const uploads = useUploads(apiBase, () => revalidator.revalidate(), c.max_file)
  const current = folders.find((f) => f.id === folder) ?? null
  const rows = folders as unknown as FolderRow[]
  const here = useMemo(() => effectivePermissions(c, rows, folder), [c, rows, folder])
  const inherited = useMemo(() => effectivePermissions(c, rows, current?.parent ?? null), [c, rows, current])
  const trail = useMemo(() => {
    const out: { id: string; name: string }[] = []
    for (let f = current; f; f = folders.find((x) => x.id === f!.parent) ?? null) out.unshift({ id: f.id, name: f.name })
    return out
  }, [current, folders])
  const href = (id: string | null, nextScope: "all" | "here" = scope) => {
    const p = new URLSearchParams()
    if (id) p.set("folder", id)
    if (nextScope === "here") p.set("scope", "here")
    return `?${p}`
  }
  const treeCounts = useMemo(() => Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, { files: v.total }])), [usage])
  const subfolders = folders.filter((f) => f.parent === folder)
  const searching = navigation.state === "loading" && navigation.location?.search.includes("q=")

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="h-fit space-y-2 rounded-lg border bg-card p-2 lg:sticky lg:top-4">
        <div className="flex items-center justify-between px-2 pt-1">
          <h2 className="text-sm font-semibold">Folders</h2>
          <Button variant="ghost" size="icon" className="size-7" aria-label="New folder" onClick={() => setNewFolder(true)}>
            <FolderPlus className="size-4" />
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <FolderTree folders={folders} current={q ? undefined : folder} href={(id) => href(id)} rootLabel={c.name} counts={treeCounts} showFlags />
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {q ? (
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                Search results for &ldquo;{q}&rdquo;
                <Button variant="ghost" size="sm" asChild>
                  <Link to={href(folder)}>
                    <X /> Clear
                  </Link>
                </Button>
              </h2>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                  <Link to={href(null)} className="hover:text-foreground">
                    {c.name}
                  </Link>
                  {trail.map((f, i) => (
                    <span key={f.id} className="contents">
                      <span>/</span>
                      {i === trail.length - 1 ? (
                        <span className="font-medium text-foreground">{f.name}</span>
                      ) : (
                        <Link to={href(f.id)} className="hover:text-foreground">
                          {f.name}
                        </Link>
                      )}
                    </span>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {here.hidden ? (
                    <Badge variant="secondary">
                      <EyeOff /> Hidden from recipients
                    </Badge>
                  ) : (
                    <>
                      <Badge variant={here.upload ? "success" : "secondary"}>{here.upload ? "Recipients can upload" : "Uploads closed"}</Badge>
                      {here.create_folder && <Badge variant="info">Recipients can create folders</Badge>}
                      {here.rename_own && <Badge variant="info">Recipients can rename their folders</Badge>}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Form method="get" className="relative" role="search">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} key={q} placeholder="Search all files" aria-label="Search all files in this collection" className="h-8 w-48 pl-8" />
            </Form>
            {!q && (
              <Button variant="outline" size="sm" onClick={() => setNewFolder(true)}>
                <Plus /> Folder
              </Button>
            )}
            {current && !q && (
              <Button variant="outline" size="sm" onClick={() => setManage(true)}>
                <FolderCog /> Manage folder
              </Button>
            )}
          </div>
        </div>

        {!q && (
          <DropZone
            compact
            onFiles={(list) => uploads.add(list, folder, current?.name ?? c.name)}
            hint={<>Uploading as administrator into {current?.name ?? "the collection root"}. Up to {formatBytes(c.max_file)} per file.</>}
          />
        )}
        <UploadList tasks={uploads.tasks} onCancel={uploads.cancel} onClear={uploads.clear} />

        {!q && subfolders.length > 0 && (
          <section className="space-y-2" aria-label="Folders">
            <h3 className="text-sm font-medium text-muted-foreground">Folders</h3>
            <FolderCards folders={subfolders} counts={usage} href={(id) => href(id)} audience="admin" />
          </section>
        )}

        <div className={searching ? "opacity-60" : undefined}>
          <FileBrowser
            files={files}
            next={next}
            apiBase={apiBase}
            folders={folders}
            rootLabel={c.name}
            query={q}
            folder={folder}
            recursive={!q && scope === "all"}
            toolbar={!q && subfolders.length > 0 ? <ScopeSwitch scope={scope} href={(s) => href(folder, s)} /> : null}
            emptyText={scope === "all" ? (subfolders.length ? "No files here or in its subfolders yet." : "No files in this folder yet.") : "No files directly in this folder. Switch to Everything inside to see the files of its subfolders."}
          />
        </div>
      </section>

      <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} parent={q ? null : folder} parentName={(q ? null : current?.name) ?? c.name} />
      {current && (
        <ManageFolderDialog
          open={manage}
          onOpenChange={setManage}
          folder={current}
          folders={folders}
          rootLabel={c.name}
          inherited={inherited}
          onDeleted={() => {
            const p = new URLSearchParams(params)
            if (current.parent) p.set("folder", current.parent)
            else p.delete("folder")
            setParams(p)
          }}
        />
      )}
    </div>
  )
}

function LinksTab({ collection: c, folders, links, origin }: Pick<Data, "folders" | "links" | "origin"> & { collection: Data["collection"] }) {
  const create = useFetcher<{ ok?: boolean; error?: string }>()
  const revoke = useFetcher()
  const regenerate = useFetcher<{ ok?: boolean }>()
  const [open, setOpen] = useState(false)
  const [replacing, setReplacing] = useState(false)
  useEffect(() => {
    if (create.state === "idle" && create.data?.ok) setOpen(false)
  }, [create.state, create.data])
  useEffect(() => {
    if (regenerate.state === "idle" && regenerate.data?.ok) setReplacing(false)
  }, [regenerate.state, regenerate.data])

  return (
    <div className="max-w-4xl space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Collection link</h2>
          <p className="text-sm text-muted-foreground">Opens the whole collection, except hidden folders.{c.password_set ? " Recipients need the password." : ""} It stays the same when you change folders or settings.</p>
        </div>
        <CopyLink url={`${origin}/s/${c.token}`} label="Collection link" />
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setReplacing(true)}>
          <KeyRound /> Replace the link
        </Button>
        <AgentHelp link={`${origin}/s/${c.token}`} password={c.password_set} folder={folders[0] ? folderPath(folders, flattenFirst(folders), "/") : ""} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-semibold">Folder links</h2>
            <p className="text-sm text-muted-foreground">A folder link opens one folder and what is inside it, never its neighbours. It uses the collection's password and expiry, and can be revoked on its own.</p>
          </div>
          <Button onClick={() => setOpen(true)} disabled={folders.length === 0}>
            <Plus /> New folder link
          </Button>
        </div>
        {links.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{folders.length === 0 ? "Create folders first: a folder link shares one of them." : "No folder links yet."}</div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folder</TableHead>
                  <TableHead>Link</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => (
                  <TableRow key={l.token}>
                    <TableCell className="max-w-[12rem] truncate font-medium">{folderPath(folders, l.folder) || "Deleted folder"}</TableCell>
                    <TableCell className="min-w-[16rem]">
                      <CopyLink url={`${origin}/s/${l.token}`} label={`Link to ${folderPath(folders, l.folder)}`} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      <Ago ts={l.created} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Revoke link" onClick={() => revoke.submit({ intent: "revoke_link", token: l.token }, { method: "post" })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder link</DialogTitle>
            <DialogDescription>Recipients of this link see only the chosen folder and its subfolders.</DialogDescription>
          </DialogHeader>
          <create.Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="create_link" />
            <div className="grid gap-2">
              <Label htmlFor="link-folder">Folder</Label>
              <NativeSelect id="link-folder" name="folder" required defaultValue={folders[0]?.id}>
                <FolderSelectOptions folders={folders} rootLabel="Choose a folder" />
              </NativeSelect>
            </div>
            {create.data?.error && <p className="text-sm text-destructive">{create.data.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.state !== "idle"}>
                Create link
              </Button>
            </DialogFooter>
          </create.Form>
        </DialogContent>
      </Dialog>

      <Dialog open={replacing} onOpenChange={setReplacing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the collection link?</DialogTitle>
            <DialogDescription>The current link stops working at once and a new one is made. Folder links keep working. Use this if the link reached the wrong people.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={regenerate.state !== "idle"} onClick={() => regenerate.submit({ intent: "regenerate_token" }, { method: "post" })}>
              Replace link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SettingsTab({ collection: c, storageLimit }: { collection: Data["collection"]; storageLimit: number }) {
  const save = useFetcher<{ ok?: boolean; error?: string }>()
  const remove = useFetcher<{ error?: string }>()
  const [saved, setSaved] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const values: SettingsValues = { ...c, upload: !!c.upload, create_folder: !!c.create_folder, rename_own: !!c.rename_own, show_files: !!c.show_files, auto_delete: !!c.auto_delete }
  useEffect(() => {
    if (save.state === "idle" && save.data?.ok) {
      setSaved(true)
      const t = setTimeout(() => setSaved(false), 2000)
      return () => clearTimeout(t)
    }
  }, [save.state, save.data])

  return (
    <div className="max-w-3xl space-y-10">
      <save.Form method="post" className="space-y-8">
        <input type="hidden" name="intent" value="settings" />
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Settings2 className="size-4" /> Details
          </h2>
          <DetailsFields values={values} />
        </section>
        <section className="space-y-4">
          <h2 className="font-semibold">Access and limits</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <FieldLabel htmlFor="password" help="Changing or removing the password signs out every recipient; they open the link again.">
                {c.password_set ? "New password" : "Password"}
              </FieldLabel>
              <Input id="password" name="password" type="password" autoComplete="new-password" maxLength={200} placeholder={c.password_set ? "Leave empty to keep the current one" : "No password"} />
              {c.password_set && (
                <label className="flex items-center gap-2 text-sm">
                  <Switch name="remove_password" /> Remove the password
                </label>
              )}
            </div>
            <ExpiryField value={c.expires} autoDelete={!!c.auto_delete} />
          </div>
          <LimitFields values={values} storageLimit={storageLimit} />
        </section>
        <section className="space-y-4">
          <h2 className="font-semibold">Recipient permissions</h2>
          <PermissionFields values={values} />
        </section>
        {save.data?.error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{save.data.error}</div>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.state !== "idle"} className={saved ? "bg-green-600 hover:bg-green-600" : undefined}>
            {save.state !== "idle" ? "Saving..." : saved ? "Saved" : "Save settings"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Created <When ts={c.created} />. The link stays the same.
          </span>
        </div>
      </save.Form>

      <section className="space-y-3 rounded-lg border border-destructive/40 p-4">
        <h2 className="font-semibold text-destructive">Delete collection</h2>
        <p className="text-sm text-muted-foreground">Deletes every received file from R2, the folders and all links. This cannot be undone.</p>
        {confirm ? (
          <remove.Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="delete_collection" />
            <Input name="confirm" placeholder={`Type "${c.name}" to confirm`} className="max-w-xs" autoFocus aria-label="Collection name" />
            <Button type="submit" variant="destructive" disabled={remove.state !== "idle"}>
              {remove.state !== "idle" ? "Deleting..." : "Delete for good"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            {remove.data?.error && <p className="w-full text-sm text-destructive">{remove.data.error}</p>}
          </remove.Form>
        ) : (
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
            <Trash2 /> Delete collection
          </Button>
        )}
      </section>
    </div>
  )
}
