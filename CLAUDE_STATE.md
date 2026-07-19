# CLAUDE_STATE.md — SmartTroli PWA

## Milestone
**M1: Core Shopping List UI + PWA Scaffold** — ✅ Complete

## Stack
- Vanilla HTML5
- Tailwind CSS (CDN, config inline in index.html)
- Modular Vanilla JS (app.js — State object + render pipeline)
- localStorage persistence
- Service Worker (cache-first with network fallback)

## File Structure
```
/index.html        → App shell, Tailwind config/theme, header, totals, form, list mount
/app.js             → State (CRUD + totals), render(), event bindings
/manifest.json      → PWA manifest (references /icons/icon-*.png — NOT YET GENERATED)
/sw.js              → Offline cache (core assets: index.html, app.js, manifest.json)
/CLAUDE_STATE.md    → This file
```

## Design Tokens (in use)
- Colors: bg #F6F4EE / bgdark #14170F, green #2F5233, greenlight #4C7A3F, orange (accent) #D9622B, rail #DDD8C6
- Type: Georgia (display, totals/headings) + system-ui (body)
- Signature element: "Trolley Rail" — horizontal progress bar showing % of items physically in trolley
- Dark mode: `prefers-color-scheme` driven via `dark:` Tailwind classes

## Features Implemented
- [x] Add item (name + estimated price) via form
- [x] Render list from State
- [x] Custom checkmark toggle → marks item "in trolley" (strike-through + dim)
- [x] Live "Estimated Total" (all items)
- [x] Live "Trolley Total" (checked items only)
- [x] Trolley Rail progress bar (% checked)
- [x] Remove item (✕ button)
- [x] Empty state
- [x] localStorage persistence across reloads
- [x] manifest.json (standalone, portrait, themed)
- [x] sw.js registered from index.html, caches core shell

## Known Gaps / Next Steps
1. **Icons missing**: `manifest.json` references `/icons/icon-192.png`, `icon-512.png`, and two maskable variants. These PNG files do NOT exist yet — must be generated/uploaded next, or manifest will show console warnings on Vercel. Icons folder is not yet part of this deliverable.
2. No edit-item capability yet (only add/remove) — candidate for M2.
3. No categories/sorting — candidate for M2.
4. No install-prompt UI (beforeinstallprompt capture) — candidate for M2.
5. Currency hardcoded to ₹ — consider config toggle if needed.
6. sw.js cache list does not include icon paths yet — update once icons exist.

## Deployment Notes (Vercel, mobile-only workflow)
- Static site, zero build step required — Tailwind loaded via CDN script tag, no npm/build config needed.
- Deploy root must contain: index.html, app.js, manifest.json, sw.js at same level (paths in code are relative, no leading slash mismatches).
- After deploy, verify sw.js registers over HTTPS (Vercel serves HTTPS by default — required for service workers).

## Next Prompt Should Request
- Icon set generation (192/512 + maskable) OR user uploads existing icons to be wired in.
- OR proceed to M2 feature set (edit items, categories, install prompt).
