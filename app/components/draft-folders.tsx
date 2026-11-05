import { useMemo, useState } from "react"
import { Check, Folder, FolderPlus, Pencil, Plus, Trash2, X } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { buildTree, flatten, MAX_DEPTH, MAX_FOLDERS, type DraftFolder } from "#/lib/folders"

const tempId = () => Math.random().toString(36).slice(2, 10)

type Preset = { label: string; tree: Record<string, Record<string, unknown>> }

const PRESETS: Preset[] = [
  { label: "Website project", tree: { Branding: { Logos: {}, "Brand guidelines": {} }, Images: { "Team photos": {}, Homepage: {} }, Documents: {}, Other: {} } },
  { label: "Photo shoot", tree: { "Raw files": {}, Selects: {}, "Final edits": {}, "Behind the scenes": {} } },
  { label: "Client onboarding", tree: { Contracts: {}, Invoices: {}, "Identity documents": {}, Assets: {} } },
  { label: "Event", tree: { Speakers: { Photos: {}, Slides: {} }, Sponsors: { Logos: {} }, Media: {} } },
]

function fromPreset(tree: Record<string, Record<string, unknown>>, parent: string | null = null): DraftFolder[] {
  return Object.entries(tree).flatMap(([name, children]) => {
    const id = tempId()
    return [{ id, name, parent }, ...fromPreset(children as Record<string, Record<string, unknown>>, id)]
  })
}

function nameError(drafts: DraftFolder[], name: string, parent: string | null, self?: string): string | null {
  const clean = name.trim()
  if (!clean) return "Enter a name."
  if (clean.length > 180 || /[\x00-\x1f/\\]/.test(clean)) return "Use 1-180 characters without slashes."
  if (drafts.some((d) => d.id !== self && d.parent === parent && d.name.toLowerCase() === clean.toLowerCase())) return "A folder with that name is already there."
  return null
}

/**
 * Plans the folder tree of a new collection. The folders are posted as JSON in the hidden `folders` field and created
 * with the collection, in one transaction.
 */
export function DraftFolders({ initial = [] }: { initial?: DraftFolder[] }) {
  const [drafts, setDrafts] = useState<DraftFolder[]>(initial)
  const [newName, setNewName] = useState("")
  const [adding, setAdding] = useState<{ parent: string; name: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = useMemo(() => flatten(buildTree(drafts)), [drafts])
  const full = drafts.length >= MAX_FOLDERS

  const add = (name: string, parent: string | null) => {
    const problem = full ? `A collection holds at most ${MAX_FOLDERS} folders.` : nameError(drafts, name, parent)
    if (problem) return setError(problem), false
    setDrafts((list) => [...list, { id: tempId(), name: name.trim(), parent }])
    setError(null)
    return true
  }
  const rename = (id: string, parent: string | null) => {
    if (!editing) return
    const problem = nameError(drafts, editing.name, parent, id)
    if (problem) return setError(problem)
    setDrafts((list) => list.map((d) => (d.id === id ? { ...d, name: editing.name.trim() } : d)))
    setEditing(null)
    setError(null)
  }
  const remove = (id: string) => {
    const doomed = new Set([id])
    for (let grew = true; grew; ) {
      grew = false
      for (const d of drafts) if (d.parent && doomed.has(d.parent) && !doomed.has(d.id)) doomed.add(d.id), (grew = true)
    }
    setDrafts((list) => list.filter((d) => !doomed.has(d.id)))
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="folders" value={JSON.stringify(drafts)} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Start from:</span>
        {PRESETS.map((p) => (
          <Button key={p.label} type="button" variant="outline" size="sm" onClick={() => (setDrafts(fromPreset(p.tree)), setError(null))}>
            {p.label}
          </Button>
        ))}
        {drafts.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setDrafts([])}>
            Clear
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No folders yet. Files then go to the collection itself. Add folders below or start from an example.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="group">
                <div className="flex items-center gap-2 py-1.5 pr-2" style={{ paddingLeft: `${12 + row.depth * 20}px` }}>
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  {editing?.id === row.id ? (
                    <div className="flex flex-1 items-center gap-1">
                      <Input
                        value={editing.name}
                        onChange={(e) => setEditing({ id: row.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.preventDefault(), rename(row.id, row.parent)
                          if (e.key === "Escape") e.preventDefault(), setEditing(null)
                        }}
                        className="h-7"
                        autoFocus
                        aria-label="Folder name"
                      />
                      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Save name" onClick={() => rename(row.id, row.parent)}>
                        <Check className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Cancel" onClick={() => setEditing(null)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                      <div className="flex shrink-0 gap-0.5 opacity-70 group-hover:opacity-100">
                        {row.depth < MAX_DEPTH - 2 && (
                          <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Add a folder inside ${row.name}`} onClick={() => setAdding({ parent: row.id, name: "" })}>
                            <FolderPlus className="size-4" />
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Rename ${row.name}`} onClick={() => setEditing({ id: row.id, name: row.name })}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="size-7 hover:text-destructive" aria-label={`Remove ${row.name}`} onClick={() => remove(row.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                {adding?.parent === row.id && (
                  <div className="flex items-center gap-1 pr-2 pb-2" style={{ paddingLeft: `${32 + row.depth * 20}px` }}>
                    <Input
                      value={adding.name}
                      onChange={(e) => setAdding({ parent: row.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault(), add(adding.name, row.id) && setAdding(null)
                        if (e.key === "Escape") e.preventDefault(), setAdding(null)
                      }}
                      placeholder={`New folder in ${row.name}`}
                      className="h-7"
                      autoFocus
                      aria-label="New subfolder name"
                    />
                    <Button type="button" size="sm" className="h-7" onClick={() => add(adding.name, row.id) && setAdding(null)}>
                      Add
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Cancel" onClick={() => setAdding(null)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (add(newName, null)) setNewName("")
            }
          }}
          placeholder="New top-level folder"
          aria-label="New top-level folder name"
          disabled={full}
        />
        <Button type="button" variant="outline" disabled={full} onClick={() => add(newName, null) && setNewName("")}>
          <Plus /> Add folder
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        {drafts.length} of {MAX_FOLDERS} folders. You can change folders and per-folder permissions at any time; the link stays the same.
      </p>
    </div>
  )
}
