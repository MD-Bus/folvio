import { Badge } from "#/components/ui/badge"

/** Open, closed, expiring soon or expired. */
export function CollectionStateBadge({ c, now }: { c: { expires: number | null; upload: number | boolean }; now: number }) {
  if (c.expires && c.expires < now) return <Badge variant="secondary">Expired</Badge>
  if (!c.upload) return <Badge variant="secondary">Closed</Badge>
  if (c.expires && c.expires - now < 7 * 86_400_000) return <Badge variant="warning">Expires soon</Badge>
  return <Badge variant="success">Open</Badge>
}
