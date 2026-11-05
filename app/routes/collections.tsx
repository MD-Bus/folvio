import { Form, Link, useSearchParams } from "react-router"
import { KeyRound, Library, Plus, Search } from "lucide-react"
import type { Route } from "./+types/collections"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { Ago } from "#/components/time"
import { Button } from "#/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#/components/ui/empty"
import { Input } from "#/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "#/components/ui/table"
import { formatBytes } from "#/lib/format"
import { requireAuth } from "~/server/auth.server"
import { listCollections } from "~/server/collections.server"
import { CollectionStateBadge } from "#/components/collection-state"

export const meta: Route.MetaFunction = () => [{ title: "Collections | Folvio" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const q = new URL(request.url).searchParams.get("q") ?? ""
  return { collections: await listCollections(env, { q }), q, now: Date.now() }
}

export default function Collections({ loaderData }: Route.ComponentProps) {
  const { collections, q, now } = loaderData
  const [params] = useSearchParams()
  return (
    <>
      <PageHeader crumbs={[{ label: "Collections" }]} />
      <div className="space-y-5 p-4 pt-0 lg:px-6">
        <PageTitle
          title="Collections"
          description="Each collection is one link with the folders you prepared. Recipients upload into the folders you allow."
          actions={
            <Button asChild>
              <Link to="/collections/new">
                <Plus /> New collection
              </Link>
            </Button>
          }
        />

        {(collections.length > 0 || q) && (
          <Form method="get" className="relative max-w-sm" role="search">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={params.get("q") ?? ""} placeholder="Search collections" aria-label="Search collections" className="pl-9" />
          </Form>
        )}

        {collections.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Library />
              </EmptyMedia>
              <EmptyTitle>{q ? "No collection matches" : "No collections yet"}</EmptyTitle>
              <EmptyDescription>{q ? `Nothing is named like "${q}".` : "Create your first collection, arrange its folders, then share one secure link."}</EmptyDescription>
            </EmptyHeader>
            {!q && (
              <Button asChild>
                <Link to="/collections/new">
                  <Plus /> New collection
                </Link>
              </Button>
            )}
          </Empty>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Collection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Files</TableHead>
                  <TableHead className="hidden md:table-cell">Storage</TableHead>
                  <TableHead className="hidden lg:table-cell">Last upload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((c) => {
                  const pct = Math.min(100, Math.round((c.bytes / c.quota) * 100))
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-[18rem]">
                        <Link to={`/collections/${c.id}`} prefetch="intent" className="flex items-center gap-1.5 font-medium hover:underline">
                          <span className="truncate">{c.name}</span>
                          {c.protected ? <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-label="Password protected" /> : null}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">{c.description || `${c.folders} folder${c.folders === 1 ? "" : "s"}`}</div>
                      </TableCell>
                      <TableCell>
                        <CollectionStateBadge c={c} now={now} />
                      </TableCell>
                      <TableCell className="hidden tabular-nums sm:table-cell">{c.files.toLocaleString("en-GB")}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="w-36 space-y-1">
                          <div className="text-xs tabular-nums">
                            {formatBytes(c.bytes)} <span className="text-muted-foreground">of {formatBytes(c.quota)}</span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-muted">
                            <div className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        <Ago ts={c.last_upload} empty="Nothing yet" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  )
}
