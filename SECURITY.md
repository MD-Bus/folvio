# Security policy

## Supported versions

| Version | Status |
| --- | --- |
| 0.1.0 development build | Unreleased; fixes target the current source |
| Published releases | None verified yet |

Folvio is pre-1.0 and has not completed a production security review. The [acceptance checklist](ACCEPTANCE.md) records remaining validation.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/momardia54/folvio/security/advisories/new). Private vulnerability reporting is enabled. Do not post exploit details, credentials or private collection links in public issues.

Include the affected version, reproduction steps, expected impact and a minimal example with secrets removed. No response-time guarantee is established for this unreleased project.

## Scope

The Worker in `src/`, frontend in `public/`, database migrations, upload authorization and default deployment configuration are in scope. Cloudflare's platform is maintained separately. Full administrator credentials and API keys intentionally grant administrative authority; unauthorized elevation from a recipient session remains a security issue.

## Security model

- **One administrator.** `ADMIN_USERNAME` and `ADMIN_PASSWORD` are runtime secrets. Login compares SHA-256 digests with an equal-length comparison. There is no default account or first-visitor registration.
- **Administrator sessions.** Random tokens are stored as hashes in D1. Cookies are HttpOnly and SameSite=Strict, with Secure on HTTPS. Sessions expire after seven days; logout deletes the record. Changing administrator credentials invalidates existing sessions.
- **Login and unlock throttling.** Requests are counted per IP and endpoint category in a 15-minute window. More than 30 attempts are rejected, including successful attempts. There is no global distributed-attack limit.
- **API keys.** Stored as hashes and shown once. Every key currently has full administrator authority. Revocation deletes the stored key. Password rotation does not revoke API keys; revoke those separately.
- **Collection access.** Public links contain random tokens. Optional collection passwords are stored as HMACs under the server secret. Recipient cookies contain a signed random browser identity tied to the collection's password value. Changing the collection password invalidates those cookies. Expiration is checked on recipient requests.
- **Folder authorization.** The server checks collection membership, inherited permissions and hidden ancestry. Recipients may create folders only where allowed and rename only their own when permitted. They cannot move/delete folders or edit permissions. Administrators retain full access.
- **Uploads.** A single database statement reserves bytes against collection and installation quotas. Pending uploads count toward those quotas. Every binary PUT checks the current authenticated caller, upload ownership, permitted directory, part number, expiration and exact byte length. The Worker streams the body into its R2 binding. Completion rechecks permissions and verifies stored size.
- **File access.** Keep R2 private. Administrator downloads require an authenticated session or API key on every request. Recipients list only their own uploads. Folder-link tokens expose only their selected subtree and are independently revocable.
- **Browser requests.** Mutation requests with a foreign Origin are rejected; requests without Origin remain supported for server API clients. Worker-handled responses include CSP, nosniff and no-referrer headers. Static assets receive equivalent security headers through `public/_headers`; live header delivery remains a deployment check.

## Known limitations

- Desktop/mobile browser and Cloudflare-emulator tests pass. Real browser-to-Worker-to-R2 uploads, including a 105 MiB file, now pass staging verification.
- Files are not scanned for malware, identified by magic bytes or stripped of metadata. Treat all received files as untrusted and scan them before opening. Only small raster images are previewed in the administrator dashboard; HTML and SVG previews are not supported.
- Recipient identity is tied to a browser cookie, not a verified person. Losing it loses access to that recipient's file listing and own-folder rename rights. The administrator retains access.
- Revoking access blocks subsequent requests, but an already-authorized request may still be transferring. Completion checks permissions again.
- D1 and R2 do not share a transaction. Interrupted operations can leave reservations or storage needing cleanup. Configure the R2 abort-incomplete-multipart lifecycle fallback and monitor it.
- Application quotas do not cap Cloudflare billing. Repeated authorized requests can consume operations. Other buckets and applications share account allowances.
- Collection password hashing uses HMAC to fit the low CPU budget, not a slow password KDF. Protect the signing secret and use strong collection passwords.
- There is no MFA, scoped API access, built-in backup/restore, or audited access history yet.

## Deployment guidance

Use HTTPS, a unique administrator password and a random `SESSION_SECRET` of at least 32 characters. Keep secrets out of Git and build logs. Keep the R2 bucket private and bind it only to the Folvio Worker. No separate S3 credentials or bucket CORS are required.

Enable the incomplete-multipart lifecycle rule, monitor Cloudflare usage, and back up D1 and R2 together. Set collection passwords and expiration dates where appropriate. Revoke unused API keys. Revoke directory links and change collection passwords if access may have been compromised.

Account recovery uses `wrangler secret put ADMIN_USERNAME` and `wrangler secret put ADMIN_PASSWORD`; there is no email recovery flow. Rotate `SESSION_SECRET` if compromised. That also invalidates recipient signatures and requires resetting existing collection passwords because their HMACs use the old secret.
