import { useMemo, useState } from "react"
import { Link } from "react-router"
import { ChevronRight, EyeOff, Folder, FolderOpen, Lock } from "lucide-react"
import { buildTree, type TreeNode } from "#/lib/folders"
import { cn } from "#/lib/utils"

export type TreeFolder = { id: string; parent: string | null; name: string; hidden?: number | boolean; permissions?: { upload: boolean; hidden: boolean } }

/** The folders of a collection as a navigable tree. Each folder links to `href(id)`; the root links to `href(null)`. */
export function FolderTree({
  folders,
  current,
  href,
  rootLabel,
  counts,
  showFlags,
}: {
  folders: TreeFolder[]
  /** The open folder (null: the root, undefined: none, e.g. while searching). */
  current: string | null | undefined
  href: (id: string | null) => string
  rootLabel: string
  counts?: Record<string, { files: number }>
  showFlags?: boolean
}) {
  const tree = useMemo(() => buildTree(folders), [folders])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderNode = (node: TreeNode<TreeFolder>) => {
    const open = !collapsed.has(node.id)
    const active = current === node.id
    const count = counts?.[node.id]?.files
    return (
      <li key={node.id}>
        <div className={cn("group flex items-center rounded-md text-sm", active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60")} style={{ paddingLeft: `${node.depth * 14}px` }}>
          {node.children.length > 0 ? (
            <button type="button" onClick={() => toggle(node.id)} className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`} aria-expanded={open}>
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <Link to={href(node.id)} preventScrollReset className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2" aria-current={active ? "page" : undefined}>
            {active ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate" title={node.name}>
              {node.name}
            </span>
            {showFlags && node.hidden ? <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Hidden from recipients" /> : null}
            {showFlags && node.permissions && !node.permissions.upload && !node.permissions.hidden ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Uploads closed" /> : null}
            {count ? <span className="ml-auto text-xs text-muted-foreground tabular-nums">{count}</span> : null}
          </Link>
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    )
  }

  return (
    <nav aria-label="Folders">
      <ul className="space-y-px">
        <li>
          <Link
            to={href(null)}
            preventScrollReset
            className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", current === null ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60")}
            aria-current={current === null ? "page" : undefined}
          >
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate" title={rootLabel}>
              {rootLabel}
            </span>
            {counts?.[""]?.files ? <span className="ml-auto text-xs text-muted-foreground tabular-nums">{counts[""].files}</span> : null}
          </Link>
        </li>
        {tree.map(renderNode)}
      </ul>
    </nav>
  )
}
