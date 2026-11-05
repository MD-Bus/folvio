import { Badge } from "#/components/ui/badge"

/** Open, closed, expiring soon or expired. */
export function CollectionStateBadge({ c, now }: { c: { expires: number | null; upload: number | boolean; auto_delete?: number | boolean }; now: number }) {
  if (c.expires && c.expires < now) return <Badge variant={c.auto_delete ? "destructive" : "secondary"}>{c.auto_delete ? "Being deleted" : "Expired"}</Badge>
  if (c.auto_delete && c.expires && c.expires - now < 7 * 86_400_000) return <Badge variant="warning">Deleted soon</Badge>
  if (!c.upload) return <Badge variant="secondary">Closed</Badge>
  if (c.expires && c.expires - now < 7 * 86_400_000) return <Badge variant="warning">Expires soon</Badge>
  return <Badge variant="success">Open</Badge>
}
