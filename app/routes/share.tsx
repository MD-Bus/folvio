import { useEffect, useMemo, useState } from "react"
import { data, Link, redirect, useFetcher, useNavigation, useRevalidator } from "react-router"
import { CalendarClock, CircleCheck, Folder, FolderPlus, Lock, Moon, Pencil, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import type { Route } from "./+types/share"
import { AgentHelp } from "#/components/agent-help"
import { FileIcon } from "#/components/file-icon"
import { FolderTree } from "#/components/folder-tree"
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
import { formatBytes } from "#/lib/format"
import { clearThrottle, throttle } from "~/server/auth.server"
import { createFolder, getFolders, permissionsAt, updateFolder, visibleFolders, type Access } from "~/server/collections.server"
import { listFiles } from "~/server/files.server"
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
  if (isExpired(c)) return { state: "expired" as const, name: c.name, expires: c.expires }
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
  const page = await listFiles(env, access, { folder, limit: 200 })
  const root = c.folder_root ? access.folders.find((f) => f.id === c.folder_root) : null
  const payload = {
    state: "open" as const,
    name: root ? root.name : c.name,
    collectionName: c.name,
    scoped: Boolean(root),
    description: c.description,
    expires: c.expires,
    maxFile: c.max_file,
    folders: folders.map(({ id, parent, name, own, permissions }) => ({ id, parent, name, own, permissions })),
    folder,
    here,
    files: page.files,
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

function Shell({ children }: { children: React.ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <img src="/favicon.svg" alt="" className="size-7 rounded-md" /> Folvio
          </span>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Switch theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
            <Sun className="hidden size-4 dark:block" />
            <Moon className="size-4 dark:hidden" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
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
          <p className="text-muted-foreground">This collection closed {loaderData.expires ? <When ts={loaderData.expires} /> : ""}. Ask the person who sent you the link for a new one.</p>
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

function Open({ data: d }: { data: OpenData }) {
  const revalidator = useRevalidator()
  const uploads = useUploads(`/api/v1/share/${d.token}`, () => revalidator.revalidate(), d.maxFile)
  const [newFolder, setNewFolder] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const current = d.folders.find((f) => f.id === d.folder) ?? null
  const trail = useMemo(() => {
    const out: { id: string; name: string }[] = []
    for (let f = current; f; f = d.folders.find((x) => x.id === f!.parent) ?? null) out.unshift({ id: f.id, name: f.name })
    return out
  }, [current, d.folders])
  const href = (id: string | null) => (id ? `?folder=${id}` : "?")
  const sent = uploads.tasks.filter((t) => t.state === "done").length
  const subfolders = useMemo(() => d.folders.filter((f) => f.parent === d.folder), [d.folders, d.folder])

  return (
    <Shell>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{d.name}</h1>
            {d.scoped && <Badge variant="secondary">Folder of {d.collectionName}</Badge>}
          </div>
          {d.description && <p className="max-w-3xl whitespace-pre-line text-muted-foreground">{d.description}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Up to {formatBytes(d.maxFile)} per file</span>
            {d.expires && (
              <span>
                Open until <When ts={d.expires} />
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="hidden h-fit space-y-2 rounded-lg border bg-card p-2 lg:block">
            <div className="flex items-center justify-between px-2 pt-1">
              <h2 className="text-sm font-semibold">Folders</h2>
              {d.here.create_folder && (
                <Button variant="ghost" size="icon" className="size-7" aria-label="New folder" onClick={() => setNewFolder(true)}>
                  <FolderPlus className="size-4" />
                </Button>
              )}
            </div>
            {d.folders.length === 0 ? <p className="px-2 pb-2 text-xs text-muted-foreground">Everything goes into {d.name}.</p> : <FolderTree folders={d.folders} current={d.folder} href={href} rootLabel={d.name} />}
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                <Link to={href(null)} className="hover:text-foreground">
                  {d.name}
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
              <div className="flex gap-2">
                {d.here.create_folder && (
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
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {subfolders.map((f) => (
                  <li key={f.id}>
                    <Link to={href(f.id)} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent">
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{f.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <DropZone onFiles={(list) => uploads.add(list, d.folder, current?.name ?? d.name)} disabled={!d.here.upload} hint={d.here.upload ? <>Into {current?.name ?? d.name}. Up to {formatBytes(d.maxFile)} per file.</> : "This folder is read-only. Choose another folder."} />
            <UploadList tasks={uploads.tasks} onCancel={uploads.cancel} onClear={uploads.clear} />
            {sent > 0 && !uploads.busy && (
              <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-500/10 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                <CircleCheck className="size-4 shrink-0" /> {sent === 1 ? "Your file was received." : `Your ${sent} files were received.`} Thank you!
              </div>
            )}

            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Your files here</h2>
              {d.files.length === 0 ? (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">You have not sent anything to this folder yet. Only you and the collection's owner see the files you send.</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {d.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <FileIcon name={f.name} className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                      <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatBytes(f.size)}</span>
                      <span className="text-xs text-muted-foreground">
                        <Ago ts={f.created} />
                      </span>
                      <Badge variant="success">Received</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <AgentHelp link={d.link} password={d.passwordSet} folder={d.folder ? folderPath(d.folders, d.folder, "/") : ""} collapsible className="bg-transparent" />
          </section>
        </div>
      </div>

      <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} parent={d.folder} parentName={current?.name ?? d.name} />
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
