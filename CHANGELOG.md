# Changelog

All notable changes to Folvio, newest first. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 (unreleased)

A full rebuild on the stack and dashboard of [Warden](https://github.com/momardia54/Warden). The database of 0.1.0 is kept: migrations 0001-0003 are unchanged and 0004 only adds columns and an index.

### Added
- **Share links work for programs and AI agents.** `/s/<token>` answers a JSON manifest (folders with paths, limits, permissions, instructions) when asked for `application/json`; one-request uploads with `PUT /api/v1/share/<token>/upload/<name>?folder=Branding/Logos`; `X-Folvio-Recipient` and `X-Folvio-Password` headers instead of cookies; folders by path everywhere. The Share dialog offers the commands and a ready-made message for an AI agent.
- Dashboard of Warden: sidebar, ⌘K search for collections and files, light/dark/system themes, overview with storage, uploads in progress and a 30-day chart.
- Wizard with folder templates; folder links tab; replace the collection link; delete a collection with its files.
- File browser: grid with image previews or list, search across the collection, select, move, rename, delete, download; per-folder counts.
- Upload queue with drag and drop, progress per file, cancel, a retry per part, and a warning before leaving the page.
- Recipient page: instructions, a folder menu saying where to put files (counts, view-only folders), folder cards, previews of the images they sent, a first-visit tour with Next, Back and Skip ("How it works" reopens it), password page, expired page, phone layout.
- Folders show their subfolders as cards and everything inside them, subfolders included (admin and recipients); `recursive=1` in the API. Admins can switch to "This folder only".
- List and image views with a thumbnail size slider. The dashboard starts in the image view, the recipient page in the list; each browser remembers the choice.
- Download a folder, or the whole collection, as a ZIP with its subfolders. The browser builds the archive (stored entries, UTF-8 names, CRC-32 while streaming), written to disk in Chrome and Edge above 500 MB; `GET /collections/<id>/archive` lists the entries.
- Recipients' folders are always created at the top level of their link, never inside another folder; the per-folder "Create subfolders" override is gone from the dashboard. The administrator still prepares nested folders.
- Option "Recipients see all files" (`show_files`): everyone with the link sees, previews and downloads all files of the folders they can open. Off by default.
- Option "Delete the collection at this date" (`auto_delete`): the hourly clean-up deletes the collection and its files after its expiry, in bounded batches. Migration 0005 adds both columns.
- Automatic provisioning of D1 (`folvio-db`) and R2 (`folvio-files`) on deploy, reusing them when they already exist (no ids to fill in), migrations applied by the Worker on the first request, `DB_SUFFIX` build variable, notice for previews without a database.
- API keys show when they were created and last used.
- In Cloudflare Workers Builds the app builds itself after the dependency install, so Workers connected with the 0.1.0 settings (no build command) deploy without changes. Node 22 is pinned in `.node-version`.

### Changed
- The API moved to `/api/v1`. Recipient endpoints are `/api/v1/share/<token>/...`; parts are sent with `PUT .../uploads/<id>/parts/<n>` (no "prepare part" step); file downloads are `.../files/<id>/download` and previews `.../files/<id>/preview`. File lists are newest first with an opaque `next` cursor. See [API.md](API.md).
- Dashboard logins: 10 attempts per 15 minutes per address. Existing dashboard sessions of 0.1.0 must sign in again; recipient cookies, API keys and collection passwords keep working.
- Recipient cookies are SameSite=Lax so a link opened from an e-mail is recognised on the first page load.

### Removed
- `scripts/deploy.mjs` (Wrangler provisions the resources itself) and the 0.1.0 static frontend (`public/app.js`).

## 0.1.0 (unreleased)

First version: collections with folder trees and permissions, recipient links, folder links, streamed multipart uploads, API keys.
