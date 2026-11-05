import { Link } from "react-router"
import { EyeOff, Folder, Lock, Upload } from "lucide-react"
import { cn } from "#/lib/utils"

export type CardFolder = { id: string; name: string; parent: string | null; hidden?: number | boolean; permissions?: { upload: boolean; hidden: boolean; create_folder?: boolean } }

/** The subfolders of the open folder as cards: name, how many files are inside, and what can be done there. */
export function FolderCards({
  folders,
  counts,
  href,
  audience,
}: {
  folders: CardFolder[]
  counts: Record<string, { total: number }>
  href: (id: string) => string
  /** "admin" flags hidden and closed folders; "recipient" says where they can upload. */
  audience: "admin" | "recipient"
}) {
  if (folders.length === 0) return null
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {[...folders]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
        .map((f) => {
          const total = counts[f.id]?.total ?? 0
          const p = f.permissions
          return (
            <li key={f.id}>
              <Link to={href(f.id)} preventScrollReset className="group flex h-full items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-accent/50">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-background">
                  <Folder className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium" title={f.name}>
                    {f.name}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {total === 0 ? "Empty" : `${total.toLocaleString("en-GB")} file${total === 1 ? "" : "s"}`}
                    {audience === "admin" && f.hidden ? (
                      <span className="flex items-center gap-0.5">
                        · <EyeOff className="size-3" /> hidden
                      </span>
                    ) : audience === "admin" && p && !p.upload ? (
                      <span className="flex items-center gap-0.5">
                        · <Lock className="size-3" /> closed
                      </span>
                    ) : null}
                  </span>
                  {audience === "recipient" && p && (
                    <span className={cn("mt-1 flex items-center gap-1 text-xs", p.upload ? "text-green-700 dark:text-green-400" : "text-muted-foreground")}>
                      {p.upload ? <Upload className="size-3" /> : <Lock className="size-3" />}
                      {p.upload ? "You can upload here" : "View only"}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
    </ul>
  )
}

/** "Everything inside" (this folder and its subfolders) or "This folder only". */
export function ScopeSwitch({ scope, href }: { scope: "all" | "here"; href: (scope: "all" | "here") => string }) {
  return (
    <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Which files to show">
      {(["all", "here"] as const).map((s) => (
        <Link key={s} to={href(s)} preventScrollReset replace aria-pressed={scope === s} className={cn("rounded px-2 py-1 transition-colors", scope === s ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
          {s === "all" ? "Everything inside" : "This folder only"}
        </Link>
      ))}
    </div>
  )
}
