# Security policy

## Supported versions

| Version | Status |
| --- | --- |
| 0.2.0 development build | Unreleased; fixes target the current source |
| Published releases | None verified yet |

Folvio is pre-1.0 and has not completed a production security review. The [acceptance checklist](ACCEPTANCE.md) records remaining validation.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/momardia54/folvio/security/advisories/new). Private vulnerability reporting is enabled. Do not post exploit details, credentials or private collection links in public issues.

Include the affected version, reproduction steps, expected impact and a minimal example with secrets removed. No response-time guarantee is established for this unreleased project.

## Scope

The Worker (`workers/`, `app/server/`), the dashboard and recipient pages (`app/routes/`, `app/components/`), database migrations, upload authorization and the default deployment configuration are in scope. Cloudflare's platform is maintained separately. Full administrator credentials and API keys intentionally grant administrative authority; unauthorized elevation from a recipient session remains a security issue.

## Security model

- **One administrator.** `ADMIN_USERNAME` and `ADMIN_PASSWORD` are runtime secrets. Login compares SHA-256 digests with an equal-length comparison. There is no default account or first-visitor registration.
- **Administrator sessions.** Random tokens are stored as hashes in D1. Cookies are HttpOnly and SameSite=Lax, with Secure on HTTPS. Sessions expire after seven days; logout deletes the record. Changing administrator credentials invalidates existing sessions. Dashboard actions also refuse a foreign `Origin`.
- **Login and unlock throttling.** Attempts are counted per address in a 15-minute window: 10 for the dashboard login (cleared by a successful login), 30 for opening password-protected links, whether by form, `open` or the `X-Folvio-Password` header. There is no global distributed-attack limit.
- **API keys.** Stored as hashes and shown once. Every key currently has full administrator authority. Revocation deletes the stored key. Password rotation does not revoke API keys; revoke those separately.
- **Collection access.** Links contain 256-bit random tokens. Optional collection passwords are stored as HMACs under the server secret. A recipient credential is a random id signed with the server secret and the collection's password value: browsers keep it in a cookie (SameSite=Lax, so a link opened from an e-mail works on the first load), programs send it as `X-Folvio-Recipient`. Changing the collection password invalidates every credential. Expiry is checked on every request.
- **Links used by programs.** A link works from code with exactly the permissions of a person holding it, and nothing more: no downloads, no moves, no deletion, only the program's own uploads are listed. The link is the credential; treat it like one.
- **Folder authorization.** The server checks collection membership, inherited permissions and hidden ancestry. Recipients may create folders only where allowed and rename only their own when permitted. They cannot move/delete folders or edit permissions. Administrators retain full access.
- **Uploads.** A single database statement reserves bytes against collection and installation quotas. Pending uploads count toward those quotas. Every binary PUT checks the current authenticated caller, upload ownership, permitted directory, part number, expiration and exact byte length. The Worker streams the body into its R2 binding. Completion rechecks permissions and verifies stored size.
- **File access.** Keep R2 private. Every download is checked: the administrator by session or API key; a recipient only for files they sent, or for any file of a folder they can open when the collection's *Recipients see all files* option is on (off by default). Folder-link tokens expose only their selected subtree and are independently revocable.
- **Active content.** Any file type is accepted, including SVG, HTML and archives, and stored unchanged. Nothing is ever rendered or executed: previews exist only for PNG, JPEG, GIF, WebP and AVIF; downloads are `application/octet-stream` attachments with `nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`, so opening a download URL saves the file instead of displaying it.
- **Automatic deletion.** A collection with *Delete at this date* is deleted, files included, by the hourly clean-up after its expiry. This cannot be undone; there is no trash.
- **Browser requests.** API requests that change something and carry a foreign Origin are rejected; requests without Origin remain supported for server clients. Pages are served with a nonce-based Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` (recipient pages: `no-referrer`), `Permissions-Policy`, HSTS on HTTPS and `Cache-Control: no-store`. Downloads and previews carry `Content-Security-Policy: default-src 'none'; sandbox`.

## Known limitations

- 0.2.0 has been verified locally in the Workers runtime with emulated D1 and R2 (see [ACCEPTANCE.md](ACCEPTANCE.md)); it has not yet been verified on a real Cloudflare account.
- Files are not scanned for malware, identified by magic bytes or stripped of metadata. Treat all received files as untrusted and scan them before opening. Only small raster images are previewed in the administrator dashboard; HTML and SVG previews are not supported.
- Recipient identity is tied to a browser cookie, not a verified person. Losing it loses access to that recipient's file listing and own-folder rename rights. The administrator retains access.
- Revoking access blocks subsequent requests, but an already-authorized request may still be transferring. Completion checks permissions again.
- D1 and R2 do not share a transaction. Interrupted operations can leave reservations or storage needing cleanup; the hourly clean-up handles them. An R2 abort-incomplete-multipart lifecycle rule is a recommended fallback.
- Application quotas do not cap Cloudflare billing. Repeated authorized requests can consume operations. Other buckets and applications share account allowances.
- Collection password hashing uses HMAC to fit the low CPU budget, not a slow password KDF. Protect the signing secret and use strong collection passwords.
- There is no MFA, scoped API access, built-in backup/restore, or audited access history yet.

## Deployment guidance

Use HTTPS, a unique administrator password and a random `SESSION_SECRET` of at least 32 characters. Keep secrets out of Git and build logs. Keep the R2 bucket private and bind it only to the Folvio Worker. No separate S3 credentials or bucket CORS are required.

Enable the incomplete-multipart lifecycle rule, monitor Cloudflare usage, and back up D1 and R2 together. Set collection passwords and expiration dates where appropriate. Revoke unused API keys. Revoke directory links and change collection passwords if access may have been compromised.

Account recovery uses `wrangler secret put ADMIN_USERNAME` and `wrangler secret put ADMIN_PASSWORD`; there is no email recovery flow. Rotate `SESSION_SECRET` if compromised. That also invalidates recipient signatures and requires resetting existing collection passwords because their HMACs use the old secret.
