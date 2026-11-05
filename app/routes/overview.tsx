import { Link } from "react-router"
import { FolderInput, Library, Plus } from "lucide-react"
import type { Route } from "./+types/overview"
import { ColumnChart } from "#/components/column-chart"
import { Fact, FactStrip } from "#/components/fact-strip"
import { FileIcon } from "#/components/file-icon"
import { PageHeader } from "#/components/page-header"
import { PageTitle } from "#/components/page-title"
import { Ago } from "#/components/time"
import { CollectionStateBadge } from "#/components/collection-state"
import { Button } from "#/components/ui/button"
import { formatBytes, plural } from "#/lib/format"
import { requireAuth } from "~/server/auth.server"
import { dailyUploads, listCollections, overviewStats } from "~/server/collections.server"
import { recentFiles } from "~/server/files.server"

export const meta: Route.MetaFunction = () => [{ title: "Overview | Folvio" }]

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const [stats, daily, recent, collections] = await Promise.all([overviewStats(env), dailyUploads(env, 30), recentFiles(env, 8), listCollections(env, { limit: 6 })])
  return {
    stats,
    daily: daily.map((d) => ({ date: new Date(d.day).toISOString().slice(0, 10), files: d.files })),
    recent,
    collections,
    now: Date.now(),
  }
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { stats, daily, recent, collections, now } = loaderData
  const used = stats.bytes + stats.reserved
  const pct = stats.limit ? Math.min(100, Math.round((used / stats.limit) * 100)) : 0
  const month = daily.reduce((n, d) => n + d.files, 0)

  return (
    <>
      <PageHeader crumbs={[{ label: "Overview" }]} />
      <div className="space-y-8 p-4 pt-0 lg:px-6">
        <PageTitle
          title="Overview"
          description={stats.collections === 0 ? "Nothing shared yet. Create a collection, prepare its folders, then share one link." : `${plural(stats.collections, "collection")}, ${plural(stats.files, "file")} received.`}
          actions={
            <Button asChild>
              <Link to="/collections/new">
                <Plus /> New collection
              </Link>
            </Button>
          }
        />

        <FactStrip>
          <Fact label="Open collections" to="/collections" value={stats.open} detail={`of ${plural(stats.collections, "collection")}`} help="Collections that accept uploads and have not expired." />
          <Fact label="Files received" value={stats.files.toLocaleString("en-GB")} detail={`${stats.week.toLocaleString("en-GB")} in the last 7 days`} />
          <Fact
            label="Storage used"
            value={formatBytes(used)}
            detail={`${pct}% of ${formatBytes(stats.limit)}`}
            tone={pct >= 90 ? "danger" : pct >= 75 ? "warning" : "default"}
            help="Received files plus space reserved by uploads in progress, against STORAGE_LIMIT_BYTES. R2's free allowance is account-wide and is not a spending cap."
          />
          <Fact label="Uploads in progress" value={stats.pending} detail={stats.pending ? `${formatBytes(stats.reserved)} reserved` : "None"} help="Reservations of files being sent. Abandoned ones are cleaned up every hour." />
        </FactStrip>

        <section className="rounded-lg border bg-card p-4">
          <ColumnChart
            title="Files received, last 30 days"
            description="Completed uploads across all collections."
            data={daily}
            series={[{ key: "files", label: "Files", color: "var(--chart-1)" }]}
            height={150}
            summary={<span className="tabular-nums">{plural(month, "file")}</span>}
          />
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="space-y-3">
            <h2 className="font-semibold">Recently received</h2>
            {recent.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                <FolderInput className="mt-0.5 size-4 shrink-0" />
                <p>No files yet. Files appear here as soon as a recipient finishes uploading.</p>
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {recent.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <FileIcon name={f.name} className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/collections/${f.collection}${f.folder ? `?folder=${f.folder}` : ""}`} className="block truncate font-medium hover:underline">
                        {f.name}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">
                        {f.collection_name}
                        {f.folder_name ? ` / ${f.folder_name}` : ""}
                        {f.owner === "admin" ? " · uploaded by you" : ""}
                      </div>
                    </div>
                    <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatBytes(f.size)}</span>
                    <span className="text-xs text-muted-foreground">
                      <Ago ts={f.created} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">Collections</h2>
              <Link to="/collections" className="text-sm text-muted-foreground hover:text-foreground">
                All collections
              </Link>
            </div>
            {collections.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                A collection is one link with the folders you prepared.{" "}
                <Link to="/collections/new" className="text-foreground underline underline-offset-2">
                  Create one
                </Link>
                .
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {collections.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Library className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/collections/${c.id}`} prefetch="intent" className="block truncate font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {plural(c.files, "file")}, {formatBytes(c.bytes)}
                      </div>
                    </div>
                    <CollectionStateBadge c={c} now={now} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

