import { useState } from "react"
import { Outlet, useLoaderData } from "react-router"
import { ShieldAlert } from "lucide-react"
import type { Route } from "./+types/app"
import { AppSidebar } from "#/components/app-sidebar"
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert"
import { SidebarInset, SidebarProvider } from "#/components/ui/sidebar"
import { NavigationProgress } from "#/components/navigation-progress"
import { CommandMenu, useCommandShortcut } from "#/components/command-menu"
import { requireAuth, securityWarnings } from "~/server/auth.server"

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const session = await requireAuth(request, env)
  return { username: session.username, warnings: securityWarnings(env), r2: Boolean(env.FILES) }
}

/** The layout data (user name, warnings) does not change while you click around. */
export function shouldRevalidate() {
  return false
}

export default function AppLayout() {
  const { username, warnings, r2 } = useLoaderData<typeof loader>()
  const [searching, setSearching] = useState(false)
  useCommandShortcut(setSearching)

  return (
    <SidebarProvider>
      <NavigationProgress />
      <AppSidebar username={username} onSearch={() => setSearching(true)} />
      <CommandMenu open={searching} onOpenChange={setSearching} />
      <SidebarInset>
        {!r2 && (
          <Alert variant="destructive" className="mx-4 mt-4 w-auto">
            <ShieldAlert />
            <AlertTitle>No file storage</AlertTitle>
            <AlertDescription>This Worker has no R2 bucket bound as FILES, so nothing can be uploaded. Activate R2 in the Cloudflare dashboard, then deploy again: the bucket is created for you.</AlertDescription>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert className="mx-4 mt-4 w-auto">
            <ShieldAlert />
            <AlertTitle>Security recommendation</AlertTitle>
            <AlertDescription>{warnings.join(" ")}</AlertDescription>
          </Alert>
        )}
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
