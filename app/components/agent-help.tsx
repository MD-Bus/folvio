import { useState } from "react"
import { Bot, Check, ChevronRight, Copy } from "lucide-react"
import { Button } from "#/components/ui/button"
import { cn } from "#/lib/utils"

/** The commands a program (or an AI agent) runs with a share link. */
export function agentCommands(link: string, { password, folder }: { password?: boolean; folder?: string } = {}) {
  const api = link.replace("/s/", "/api/v1/share/")
  const auth = password ? ` -H "X-Folvio-Password: $PASSWORD"` : ""
  return `# what the link contains: folders, limits, permissions and its API
curl -H "Accept: application/json"${auth} ${link}

# send a file (up to 95 MB per request): the file name goes in the address
curl${auth} -T report.pdf "${api}/upload/report.pdf?folder=${encodeURIComponent(folder ?? "Branding/Logos").replace(/%2F/g, "/")}"`
}

/** A message to paste to an AI agent or a colleague's script: the link explains the rest itself. */
export function agentPrompt(link: string, password?: boolean) {
  return `Upload the files to this Folvio collection: ${link}
${password ? "It is password protected: send the password in the X-Folvio-Password header.\n" : ""}Fetch the link with the header "Accept: application/json" to get its folders, limits and API, then upload each file with PUT <api base>/upload/<file name>?folder=<folder path>.`
}

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        } catch {}
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  )
}

/** "This link also works from code": the commands, and a ready-made message for an AI agent. */
export function AgentHelp({ link, password, folder, collapsible = false, className }: { link: string; password?: boolean; folder?: string; collapsible?: boolean; className?: string }) {
  const [open, setOpen] = useState(!collapsible)
  const commands = agentCommands(link, { password, folder })
  return (
    <div className={cn("min-w-0 rounded-lg border bg-card", className)}>
      <button type="button" onClick={() => collapsible && setOpen((o) => !o)} className={cn("flex w-full items-start gap-3 p-4 text-left", !collapsible && "cursor-default")} aria-expanded={open}>
        <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Programs and AI agents can use this link too</span>
          <span className="block text-xs text-muted-foreground">Same link, same permissions. No account or API key needed: the link answers in JSON and explains its own API.</span>
        </span>
        {collapsible && <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />}
      </button>
      {open && (
        <div className="space-y-3 border-t p-4">
          <pre className="rounded-md bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{commands}</pre>
          <div className="flex flex-wrap gap-2">
            <CopyText text={commands} label="Copy commands" />
            <CopyText text={agentPrompt(link, password)} label="Copy message for an AI agent" />
          </div>
        </div>
      )}
    </div>
  )
}
