// Cloudflare Workers Builds sets WORKERS_CI=1 and installs dependencies before running the build and deploy commands.
// A Worker connected while Folvio needed no build step may still have an empty build command, and `wrangler deploy`
// alone cannot bundle a React Router app. So in Workers Builds the app is built right after the install: whatever
// the dashboard's build command is, `npx wrangler deploy` or `npx wrangler versions upload` then finds the build.
// Everywhere else (your machine, GitHub Actions) this does nothing.
import { execSync } from "node:child_process"

if (process.env.WORKERS_CI === "1" && process.env.FOLVIO_SKIP_CI_BUILD !== "1") {
  console.log("[folvio] Workers Builds detected: building the app after install.")
  execSync("npm run build", { stdio: "inherit" })
}
