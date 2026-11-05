import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Eye, FolderOpen, FolderPlus, Images, Upload } from "lucide-react"
import { Button } from "#/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "#/components/ui/dialog"
import { formatBytes } from "#/lib/format"
import { cn } from "#/lib/utils"

type Step = { icon: React.ComponentType<{ className?: string }>; title: string; body: React.ReactNode }

/**
 * A short guided tour shown the first time someone opens a link in a browser (remembered per link in this browser).
 * Skip closes it at once; "How it works" in the header opens it again.
 */
export function RecipientTour({
  token,
  name,
  description,
  maxFile,
  canCreateFolders,
  seesAll,
  open,
  onOpenChange,
}: {
  token: string
  name: string
  description: string
  maxFile: number
  canCreateFolders: boolean
  seesAll: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  const steps: Step[] = [
    {
      icon: FolderOpen,
      title: `Welcome to ${name}`,
      body: (
        <>
          <p>You were invited to send files here. It takes a minute and needs no account.</p>
          {description && <p className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-3 whitespace-pre-line text-foreground">{description}</p>}
        </>
      ),
    },
    {
      icon: Images,
      title: "1. Pick the right folder",
      body: (
        <p>
          The folders on the left (or the cards on a phone) were prepared for you, so every file lands in the right place. Open a folder: it shows its subfolders and the files inside. Folders marked <strong>View only</strong> do not take uploads.
        </p>
      ),
    },
    {
      icon: Upload,
      title: "2. Add your files",
      body: (
        <p>
          Drag files onto the drop area, or press <strong>Choose files</strong>. Any kind of file works: documents, images, videos, ZIP archives. You can send several at once, up to {formatBytes(maxFile)} each. Keep the page open until every file shows a green check.
        </p>
      ),
    },
    ...(canCreateFolders
      ? [
          {
            icon: FolderPlus,
            title: "Need another folder?",
            body: <p>Press <strong>New folder</strong> to add one next to the other folders, then open it and add your files.</p>,
          },
        ]
      : []),
    {
      icon: Eye,
      title: "3. Check what you sent",
      body: seesAll ? (
        <p>Each folder shows its files, including what others sent: images with a preview, other files with their type. Click a file to download it.</p>
      ) : (
        <p>
          Each folder shows the files <strong>you</strong> sent: images with a preview, other files with their type. Others who have this link do not see your files, and you do not see theirs. The owner of the collection receives everything.
        </p>
      ),
    },
  ]

  const finish = () => {
    try {
      localStorage.setItem(`folvio:tour:${token}`, "done")
    } catch {}
    onOpenChange(false)
  }
  const current = steps[Math.min(step, steps.length - 1)]
  const last = step >= steps.length - 1

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : finish())}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={false}>
        <div className="flex shrink-0 flex-col items-center gap-3 bg-muted/50 px-6 pt-8 pb-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-background shadow-sm ring-1 ring-border">
            <current.icon className="size-5" />
          </span>
          <DialogTitle className="text-lg [overflow-wrap:anywhere]">{current.title}</DialogTitle>
        </div>
        <DialogDescription asChild>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5 text-sm leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">{current.body}</div>
        </DialogDescription>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-6 py-4">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30")} />
            ))}
          </div>
          <div className="flex gap-2">
            {!last && (
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip
              </Button>
            )}
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={() => setStep(step - 1)} aria-label="Back">
                <ArrowLeft />
              </Button>
            )}
            {last ? (
              <Button size="sm" onClick={finish} autoFocus>
                Start uploading
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep(step + 1)} autoFocus>
                Next <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** True the first time this browser opens the link. */
export function useFirstVisit(token: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(`folvio:tour:${token}`) !== "done") setOpen(true)
    } catch {}
  }, [token])
  return [open, setOpen]
}
