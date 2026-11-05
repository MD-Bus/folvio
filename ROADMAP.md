# Roadmap

Folvio is a single-admin file collection app for freelancers, agencies and small teams. Current version: **0.1.0, unreleased**. It targets Cloudflare's free allowances for modest usage.

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

## Before the first release

- [ ] Publish the source repository and verify the Deploy button target.
- [x] Implement automatic D1/R2 provisioning and migrations in the CLI deployment command.
- [ ] Validate a fresh install, including runtime secrets, automatic resource provisioning and lifecycle setup.
- [ ] Exercise the complete acceptance checklist on real Workers Free, D1 and R2.
- [x] Verify browser uploads over 100 MB, directory isolation and incorrect part lengths.
- [x] Verify abandoned multipart cleanup and quota release on real storage.
- [ ] Run more production failure-injection tests around interrupted completion.
- [x] Sample staging Worker CPU: p99 9.409 ms; zero Worker errors.
- [ ] Validate a larger workload and account-wide usage over time.
- [x] Check desktop/mobile workflows in Chrome and capture README screenshots.
- [ ] Complete a keyboard and assistive-technology accessibility review.
- [x] Generate a dependency lockfile and pass a clean installation with zero audit findings.
- [ ] Run the prepared CI workflow on the published repository.
- [ ] Enable private vulnerability reporting on the published repository.

## Next: reliability and administration

- [ ] Downloadable metadata export and a documented, tested backup/restore workflow.
- [ ] Storage and pending-upload usage meter in the dashboard.
- [ ] Upload retry/resume controls and clearer recovery for interrupted transfers.
- [x] In-process concurrency and failure-injection coverage for reservations, revisions, completion/cancellation and cleanup.
- [ ] Verify those failure scenarios against the Cloudflare runtime and real R2.
- [ ] Machine-readable OpenAPI specification checked against the implementation.
- [ ] Scoped API keys for integrations that do not need full administrator access.
- [x] Search loaded files and move/delete selected files using bounded sequential requests.

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
