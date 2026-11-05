import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router"

import type { Route } from "./+types/root"
import "./app.css"
import { ThemeProvider } from "#/components/theme-provider"

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "manifest", href: "/site.webmanifest" },
]

export const meta: Route.MetaFunction = () => [
  { title: "Folvio - File collections" },
  { name: "description", content: "Prepare folders, share one link and receive every file in the right place, from your own Cloudflare account." },
  { name: "robots", content: "noindex" },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

/** The nonce belongs to the document that was served; refetching it on every click is pointless. */
export function shouldRevalidate() {
  return false
}

export function loader({ context }: Route.LoaderArgs) {
  return { nonce: context.cloudflare.nonce }
}

export default function App() {
  const { nonce } = useLoaderData<typeof loader>()
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
      <Outlet />
    </ThemeProvider>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Not found" : `Error ${error.status}`
    details = error.status === 404 ? "The requested page could not be found." : (typeof error.data === "string" && error.data) || error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <img src="/favicon.svg" alt="" className="size-12 rounded-xl" />
      <h1 className="text-2xl font-semibold tracking-tight">{message}</h1>
      <p className="text-muted-foreground">{details}</p>
      <a href="/" className="text-sm underline underline-offset-4">
        Back to Folvio
      </a>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
