import { useEffect, useMemo, useState } from "react"
import { data, Link, redirect, useFetcher, useNavigation, useRevalidator } from "react-router"
import { CalendarClock, ChevronRight, CircleCheck, CircleHelp, Eye, EyeOff, Folder, FolderOpen, FolderPlus, Lock, Moon, Pencil, Sun, Upload } from "lucide-react"
import { useTheme } from "next-themes"
import type { Route } from "./+types/share"
import { AgentHelp } from "#/components/agent-help"
import { FileTypeTile } from "#/components/file-icon"
import { FolderCards } from "#/components/folder-cards"
import { RecipientTour, useFirstVisit } from "#/components/recipient-tour"
import { NewFolderDialog } from "#/components/folder-dialogs"
import { Ago, When } from "#/components/time"
import { DropZone, UploadList } from "#/components/upload-panel"
import { Badge } from "#/components/ui/badge"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "#/components/ui/dialog"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { useUploads } from "#/hooks/use-uploads"
import { folderPath } from "#/lib/folders"
import { canPreview, formatBytes } from "#/lib/format"
import { cn } from "#/lib/utils"
import { clearThrottle, throttle } from "~/server/auth.server"
import { createFolder, getFolders, permissionsAt, updateFolder, visibleFolders, type Access } from "~/server/collections.server"
import { folderCounts, listFiles } from "~/server/files.server"
import { attempt } from "~/server/forms.server"
import { findShare, isExpired, openShare, recipientAccess, recipientId } from "~/server/share.server"
import { HttpError } from "~/server/util.server"

export const meta: Route.MetaFunction = ({ data, params }) => [
  { title: data && "name" in data && data.name ? `${data.name} | Folvio` : "Folvio" },
  { tagName: "link", rel: "alternate", type: "application/json", href: `/api/v1/share/${params.token}` },
  { name: "robots", content: "noindex, nofollow" },
  { name: "referrer", content: "no-referrer" },
]

/** The recipient cookie set while loading (first visit to a link without password) reaches the browser. */
export function headers({ loaderHeaders, actionHeaders }: Route.HeadersArgs) {
  const out = new Headers({ "Referrer-Policy": "no-referrer" })
  const cookie = actionHeaders.get("set-cookie") ?? loaderHeaders.get("set-cookie")
  if (cookie) out.set("set-cookie", cookie)
  return out
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const c = await findShare(env, params.token)
  if (!c) throw data("This link does not exist or was revoked.", { status: 404 })
  if (isExpired(c)) return { state: "expired" as const, name: c.name, expires: c.expires, autoDelete: Boolean(c.auto_delete) }
  let owner = await recipientId(request, env, c)
  let cookie: string | null = null
  if (!owner) {
    if (c.password) return { state: "locked" as const, name: c.name, description: c.description }
    const opened = await openShare(request, env, c, "")
    owner = opened.owner
    cookie = opened.cookie
  }
  const access: Access = { c, folders: await getFolders(env, c.id), owner, admin: false }
  const folders = visibleFolders(access)
  const url = new URL(request.url)
  let folder = url.searchParams.get("folder") || null
  if (folder && !folders.some((f) => f.id === folder)) folder = null
  const here = permissionsAt(access, folder ?? c.folder_root)
  // A folder shows everything inside it, subfolders included.
  const [page, counts] = await Promise.all([listFiles(env, access, { folder, limit: 200, recursive: true }), folderCounts(env, access)])
  const root = c.folder_root ? access.folders.find((f) => f.id === c.folder_root) : null
  const payload = {
    state: "open" as const,
    name: root ? root.name : c.name,
    collectionName: c.name,
    scoped: Boolean(root),
    description: c.description,
    expires: c.expires,
    autoDelete: Boolean(c.auto_delete),
    maxFile: c.max_file,
    folders: folders.map(({ id, parent, name, own, permissions }) => ({ id, parent, name, own, permissions })),
    folder,
    here,
    permissionsTop: permissionsAt(access, c.folder_root),
    files: page.files,
    more: Boolean(page.next),
    counts,
    showFiles: Boolean(c.show_files),
    rootKey: c.folder_root ?? "",
    token: params.token,
    link: `${url.origin}/s/${params.token}`,
    passwordSet: Boolean(c.password),
  }
  return cookie ? data(payload, { headers: { "set-cookie": cookie } }) : payload
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env
  const form = await request.formData()
  const intent = String(form.get("intent") ?? "")
  if (intent === "unlock") {
    const c = await findShare(env, params.token)
    if (!c) throw data("This link does not exist or was revoked.", { status: 404 })
    try {
      await throttle(request, env, "open", 30)
      const { cookie } = await openShare(request, env, c, String(form.get("password") ?? ""))
      await clearThrottle(request, env, "open")
      return redirect(`/s/${params.token}`, { headers: { "set-cookie": cookie } })
    } catch (error) {
      if (error instanceof HttpError) return data({ intent, error: error.message }, { status: error.status })
      throw error
    }
  }
  return attempt(intent, async () => {
    const access = await recipientAccess(request, env, params.token)
    if (intent === "create_folder") return { id: await createFolder(env, access, { name: form.get("name"), parent: String(form.get("parent") ?? "") || null }) }
    if (intent === "rename_folder") return void (await updateFolder(env, access, String(form.get("folder")), { name: form.get("name") }))
    throw new HttpError(400, "Unknown action.")
  })
}

function Shell({ children, onHelp }: { children: React.ReactNode; onHelp?: () => void }) {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <img src="/favicon.svg" alt="" className="size-7 rounded-md" /> Folvio
          </span>
          <div className="flex items-center gap-1">
            {onHelp && (
              <Button variant="ghost" size="sm" onClick={onHelp}>
                <CircleHelp /> How it works
              </Button>
            )}
            <Button variant="ghost" size="icon" className="size-8" aria-label="Switch theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              <Sun className="hidden size-4 dark:block" />
              <Moon className="size-4 dark:hidden" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  )
}

export default function Share({ loaderData }: Route.ComponentProps) {
  if (loaderData.state === "expired") {
    return (
      <Shell>
        <div className="mx-auto max-w-md space-y-3 py-16 text-center">
          <CalendarClock className="mx-auto size-10 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">{loaderData.name}</h1>
          <p className="text-muted-foreground">
            This collection closed {loaderData.expires ? <When ts={loaderData.expires} /> : ""}
            {loaderData.autoDelete ? " and its files are deleted" : ""}. Ask the person who sent you the link for a new one.
          </p>
        </div>
      </Shell>
    )
  }
  if (loaderData.state === "locked") return <Unlock name={loaderData.name} description={loaderData.description} />
  return <Open data={loaderData} />
}

function Unlock({ name, description }: { name: string; description: string }) {
  const navigation = useNavigation()
  const fetcher = useFetcher<{ error?: string }>()
  return (
    <Shell>
      <div className="mx-auto max-w-sm space-y-6 py-12">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-background shadow-sm ring-1 ring-border">
            <Lock className="size-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-sm text-muted-foreground">{description || "This collection is protected. Enter the password you received with the link."}</p>
        </div>
        <fetcher.Form method="post" className="space-y-4 rounded-lg border bg-card p-5">
          <input type="hidden" name="intent" value="unlock" />
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoFocus autoComplete="current-password" />
          </div>
          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          <Button type="submit" className="w-full" disabled={fetcher.state !== "idle" || navigation.state !== "idle"}>
            {fetcher.state !== "idle" ? "Opening..." : "Open collection"}
          </Button>
        </fetcher.Form>
      </div>
    </Shell>
  )
}

type OpenData = Extract<Route.ComponentProps["loaderData"], { state: "open" }>
type RFolder = OpenData["folders"][number]

/** The folder menu: what each folder is for at a glance, with the number of files and whether uploads are open. */
function FolderMenu({ d, href }: { d: OpenData; href: (id: string | null) => string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const rows = (parent: string | null, depth: number): React.ReactNode[] =>
    d.folders
      .filter((f) => f.parent === parent)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
      .flatMap((f) => {
        const kids = d.folders.some((x) => x.parent === f.id)
        const open = !collapsed.has(f.id)
        return [
          <li key={f.id}>
            <div className={cn("flex items-center rounded-md", d.folder === f.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")} style={{ paddingLeft: depth * 14 }}>
              {kids ? (
                <button
                  type="button"
                  className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={open ? `Collapse ${f.name}` : `Expand ${f.name}`}
                  aria-expanded={open}
                  onClick={() => setCollapsed((s) => (s.has(f.id) ? new Set([...s].filter((x) => x !== f.id)) : new Set([...s, f.id])))}
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <Link to={href(f.id)} preventScrollReset aria-current={d.folder === f.id ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-sm">
                {d.folder === f.id ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
                <span className={cn("truncate", d.folder === f.id && "font-medium")}>{f.name}</span>
                {!f.permissions.upload && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="View only" />}
                {(d.counts[f.id]?.total ?? 0) > 0 && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{d.counts[f.id].total}</span>}
              </Link>
            </div>
          </li>,
          ...(open ? rows(f.id, depth + 1) : []),
        ]
      })
  const rootTotal = d.counts[d.rootKey]?.total ?? 0
  return (
    <nav aria-label="Folders" className="space-y-3">
      <div className="px-2">
        <h2 className="text-sm font-semibold">Where to put your files</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Pick a folder, then add files to it.</p>
      </div>
      <ul className="space-y-px">
        <li>
          <Link
            to={href(null)}
            preventScrollReset
            aria-current={d.folder === null ? "page" : undefined}
            className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", d.folder === null ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60")}
          >
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{d.name}</span>
            {!d.permissionsTop.upload && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="View only" />}
            {rootTotal > 0 && <span className="ml-auto text-xs text-muted-foreground tabular-nums">{rootTotal}</span>}
          </Link>
        </li>
        {rows(null, 1)}
      </ul>
      <div className="space-y-1.5 border-t px-2 pt-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <span className="rounded bg-muted px-1 tabular-nums">3</span> files inside, subfolders included
        </p>
        <p className="flex items-center gap-1.5">
          <Lock className="size-3" /> View only: no uploads here
        </p>
        <p className="flex items-center gap-1.5">
          {d.showFiles ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
          {d.showFiles ? "Everyone with the link sees all files" : "Only you and the owner see your files"}
        </p>
      </div>
    </nav>
  )
}

function Open({ data: d }: { data: OpenData }) {
  const revalidator = useRevalidator()
  const base = `/api/v1/share/${d.token}`
  const uploads = useUploads(base, () => revalidator.revalidate(), d.maxFile)
  const [newFolder, setNewFolder] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [tour, setTour] = useFirstVisit(d.token)
  const current = d.folders.find((f) => f.id === d.folder) ?? null
  const href = (id: string | null) => (id ? `?folder=${id}` : "?")
  const sent = uploads.tasks.filter((t) => t.state === "done").length
  const subfolders = useMemo(() => d.folders.filter((f) => f.parent === d.folder), [d.folders, d.folder])
  const trail = useMemo(() => {
    const out: RFolder[] = []
    for (let f = current; f; f = d.folders.find((x) => x.id === f!.parent) ?? null) out.unshift(f)
    return out
  }, [current, d.folders])
  const placeOf = (folder: string | null) => (folder === d.folder ? null : folder ? folderPath(d.folders, folder) : d.name)
  const here = current?.name ?? d.name

  return (
    <Shell onHelp={() => setTour(true)}>
      <div className="space-y-6">
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{d.name}</h1>
            {d.scoped && <Badge variant="secondary">Folder of {d.collectionName}</Badge>}
          </div>
          {d.description && <p className="mt-2 max-w-3xl whitespace-pre-line text-muted-foreground">{d.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
              <Upload className="size-3" /> Up to {formatBytes(d.maxFile)} per file
            </span>
            {d.expires && (
              <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
                <CalendarClock className="size-3" /> Open until <When ts={d.expires} />
                {d.autoDelete ? ", then deleted" : ""}
              </span>
            )}
            <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
              {d.showFiles ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              {d.showFiles ? "Shared: everyone sees all files" : "Private: only you and the owner see your files"}
            </span>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="hidden h-fit rounded-lg border bg-card p-2 pt-3 lg:sticky lg:top-20 lg:block">
            <FolderMenu d={d} href={href} />
          </aside>

          <section className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                  <Link to={href(null)} className="hover:text-foreground">
                    {d.name}
                  </Link>
                  {trail.map((f, i) => (
                    <span key={f.id} className="contents">
                      <ChevronRight className="size-3.5" />
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
                <Badge variant={d.here.upload ? "success" : "secondary"}>
                  {d.here.upload ? <Upload /> : <Lock />}
                  {d.here.upload ? `You can upload to ${here}` : `${here} is view only`}
                </Badge>
              </div>
              <div className="flex gap-2">
                {d.permissionsTop.create_folder && (
                  <Button variant="outline" size="sm" onClick={() => setNewFolder(true)}>
                    <FolderPlus /> New folder
                  </Button>
                )}
                {current?.own && current.permissions.rename_own && (
                  <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
                    <Pencil /> Rename
                  </Button>
                )}
              </div>
            </div>

            {subfolders.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-medium text-muted-foreground">{d.folder ? `Folders in ${here}` : "Folders"}</h2>
                <FolderCards folders={subfolders} counts={d.counts} href={(id) => href(id)} audience="recipient" />
              </div>
            )}

            <DropZone
              onFiles={(list) => uploads.add(list, d.folder, here)}
              disabled={!d.here.upload}
              hint={d.here.upload ? <>Any kind of file (documents, images, videos, ZIP archives...) goes into {here}. Up to {formatBytes(d.maxFile)} each.</> : "This folder is view only. Choose a folder that accepts uploads."}
            />
            <UploadList tasks={uploads.tasks} onCancel={uploads.cancel} onClear={uploads.clear} />
            {sent > 0 && !uploads.busy && (
              <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-500/10 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                <CircleCheck className="size-4 shrink-0" /> {sent === 1 ? "Your file was received." : `Your ${sent} files were received.`} Thank you!
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{d.showFiles ? `Files in ${here}` : `Your files in ${here}`}</h2>
                <span className="text-xs text-muted-foreground">{d.files.length ? `${d.files.length}${d.more ? "+" : ""} file${d.files.length === 1 ? "" : "s"}, subfolders included` : ""}</span>
              </div>
              {d.files.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  {d.showFiles ? "Nothing here yet." : "You have not sent anything here yet."} Files you add appear here: images with a preview, every other file with its type.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {d.files.map((f) => (
                    <li key={f.id} className="overflow-hidden rounded-lg border bg-card">
                      <a href={`${base}/files/${f.id}/download`} download className="block" title={`Download ${f.name}`}>
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted/50">
                          {canPreview(f.name, f.size) ? <img src={`${base}/files/${f.id}/preview`} alt="" loading="lazy" className="size-full object-cover" /> : <FileTypeTile name={f.name} />}
                        </div>
                        <div className="space-y-0.5 p-2.5">
                          <div className="truncate text-sm font-medium">{f.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {formatBytes(f.size)} · <Ago ts={f.created} />
                          </div>
                          {placeOf(f.folder) && <div className="truncate text-xs text-muted-foreground">in {placeOf(f.folder)}</div>}
                          {d.showFiles && f.own && <div className="text-xs text-green-700 dark:text-green-400">Sent by you</div>}
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <AgentHelp link={d.link} password={d.passwordSet} folder={d.folder ? folderPath(d.folders, d.folder, "/") : ""} collapsible className="bg-transparent" />
          </section>
        </div>
      </div>

      <RecipientTour token={d.token} name={d.name} description={d.description} maxFile={d.maxFile} canCreateFolders={d.permissionsTop.create_folder} seesAll={d.showFiles} open={tour} onOpenChange={setTour} />
      <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} parent={null} parentName={d.name} note="New folders are created at the top level, next to the others." />
      {current && <RenameDialog open={renaming} onOpenChange={setRenaming} folder={current} />}
    </Shell>
  )
}

function RenameDialog({ open, onOpenChange, folder }: { open: boolean; onOpenChange: (open: boolean) => void; folder: { id: string; name: string } }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>()
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onOpenChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>You can rename folders you created.</DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="grid gap-4" key={folder.id + String(open)}>
          <input type="hidden" name="intent" value="rename_folder" />
          <input type="hidden" name="folder" value={folder.id} />
          <Input name="name" defaultValue={folder.name} required maxLength={180} autoFocus aria-label="Folder name" />
          {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={fetcher.state !== "idle"}>
              Rename
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  )
}
