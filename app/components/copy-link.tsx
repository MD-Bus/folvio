import { useState } from "react"
import { Check, Copy, ExternalLink } from "lucide-react"
import { Button } from "#/components/ui/button"

/** A share link with Copy and Open buttons. */
export function CopyLink({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex min-w-0 items-stretch gap-2">
      <code className="flex min-w-0 flex-1 items-center truncate rounded-md border bg-muted px-3 py-2 font-mono text-xs" title={url} aria-label={label}>
        {url}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-auto"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          } catch {}
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button asChild type="button" variant="ghost" size="sm" className="h-auto" aria-label="Open link in a new tab">
        <a href={url} target="_blank" rel="noreferrer">
          <ExternalLink />
        </a>
      </Button>
    </div>
  )
}
