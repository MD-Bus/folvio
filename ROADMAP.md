# Roadmap

Folvio is a single-admin file collection app for freelancers, agencies and small teams. Current version: **0.2.0, unreleased**. It targets Cloudflare's free allowances for modest usage.

This is a plan, not a promise. Order may change.

## Versioning

- Before 1.0, minor releases may change the API or data model; patch releases fix bugs.
- Document compatibility changes and migration steps in [CHANGELOG.md](CHANGELOG.md).
- Keep released database migrations unchanged; add new migrations for schema changes.
- Date the changelog when a release is actually published, then tag that version.
- A future 1.0 release establishes a stable API contract.

## 0.1.0: current implementation

- [x] Administrator login, sessions and revocable API keys.
- [x] Collection wizard with an editable nested folder tree.
- [x] Stable collection URLs, passwords, expiration and quotas.
- [x] Server-enforced inherited folder permissions and hidden folders.
- [x] Recipient folder creation disabled by default; optional own-folder renaming.
- [x] Worker-streamed multipart uploads, exact part sizes and completion verification.
- [x] File listing, administrator downloads and deletion.
- [x] API documentation and free-tier deployment guidance.

## 0.2.0: rebuild on Warden's stack

- [x] React Router 7 dashboard with Warden's UI kit, ⌘K search, themes and phone layout.
- [x] Automatic D1/R2 provisioning on deploy and in-Worker migrations.
- [x] Image previews, grid/list, collection-wide search, bulk move and delete.
- [x] Share links usable by programs and AI agents (JSON manifest, one-request upload, folder paths, header credentials).
- [x] Storage and pending-upload usage on the overview.
- [x] Per-part retry on dropped connections.

## Before the first release

- [ ] Publish the source repository and verify the Deploy button target.
- [x] Automatic D1/R2 provisioning by Wrangler and migrations by the Worker.
- [ ] Validate a fresh install, including runtime secrets, automatic resource provisioning and lifecycle setup.
- [ ] Exercise the complete acceptance checklist on real Workers Free, D1 and R2.
- [ ] Re-verify 0.2.0 on real R2: uploads over 100 MB, folder-link isolation, incorrect part lengths, abandoned-upload clean-up (0.1.0 passed these on staging; 0.2.0 is verified locally).
- [ ] Run more production failure-injection tests around interrupted completion.
- [ ] Sample 0.2.0 Worker CPU on a real account (0.1.0: p99 9.4 ms).
- [ ] Validate a larger workload and account-wide usage over time.
- [x] Check desktop/mobile workflows in Chrome and capture README screenshots.
- [ ] Complete a keyboard and assistive-technology accessibility review.
- [x] Generate a dependency lockfile and pass a clean installation with zero audit findings.
- [ ] Run the prepared CI workflow on the published repository.
- [ ] Enable private vulnerability reporting on the published repository.

## Next: reliability and administration

- [ ] Downloadable metadata export and a documented, tested backup/restore workflow.
- [ ] Resume an interrupted upload after a page reload.
- [x] In-process concurrency and failure-injection coverage for reservations, revisions, completion/cancellation and cleanup.
- [ ] Verify those failure scenarios against the Cloudflare runtime and real R2.
- [ ] Machine-readable OpenAPI specification checked against the implementation.
- [ ] Scoped API keys for integrations that do not need full administrator access.
- [ ] ZIP download of a folder (outside the Worker's CPU budget today; needs a streaming approach).
- [ ] E-mail or webhook notification when files arrive.

## Towards 1.0

- [ ] Complete security review and resolve findings.
- [ ] Verify upgrade paths and backup restoration.
- [ ] Stabilize the API and document compatibility guarantees.
- [ ] Validate the stated free-tier operating envelope with measured workloads.

## Outside the current scope

- Multi-user administrator accounts and team billing.
- Email-based login or password recovery; credentials are Worker secrets.
- Server-side media processing, antivirus scanning or ZIP generation inside Workers Free.
- Unlimited free storage, uploads or guaranteed zero-cost hosting.
