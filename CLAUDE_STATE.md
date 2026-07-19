# CLAUDE_STATE.md — SmartTroli PWA

## Milestone
**M1.1: Blank Functional Template + RM Currency** — ✅ Complete

## Stack
- Vanilla HTML5
- Tailwind CSS (CDN, config inline in index.html)
- Modular Vanilla JS (app.js — State object + render pipeline)
- localStorage persistence
- Service Worker (cache-first with network fallback)

## File Structure
```
/index.html        → App shell, Tailwind config/theme, header, totals, form, list mount, Clear All button
/app.js             → State (CRUD + clearAll + totals), render(), event bindings, RM formatter
/manifest.json      → PWA manifest (references /icons/icon-*.png — NOT YET GENERATED)
/sw.js              → Offline cache (core assets: index.html, app.js, manifest.json)
/CLAUDE_STATE.md    → This file
```

## Changes This Iteration
- [x] Confirmed blank initial state — no hardcoded/seed items; list renders empty on first load
- [x] Empty state copy updated -> "Your trolley is empty. Add your first item above!"
- [x] Currency fully switched from previous symbol to RM across: price input placeholder, item row prices, Estimated Total, Trolley Total (fmt() in app.js now returns "RM 0.00" format)
- [x] Added Clear All button (header row above list) — confirms via native confirm() before wiping State + localStorage
- [x] Live "Trolley Total" recalculation on checkbox toggle confirmed working (unchanged logic, re-verified against RM formatter)

## Design Tokens (unchanged)
- Colors: bg #F6F4EE / bgdark #14170F, green #2F5233, greenlight #4C7A3F, orange (accent) #D9622B, rail #DDD8C6
- Type: Georgia (display, totals/headings) + system-ui (body)
- Signature element: "Trolley Rail" — horizontal progress bar showing % of items physically in trolley
- Dark mode: prefers-color-scheme driven via dark: Tailwind classes

## Features Implemented
- [x] Add item (name + estimated price) via form
- [x] Render list from State (starts empty every fresh install/localStorage clear)
- [x] Custom checkmark toggle -> marks item "in trolley" (strike-through + dim)
- [x] Live "Estimated Total" (all items, RM format)
- [x] Live "Trolley Total" (checked items only, RM format)
- [x] Trolley Rail progress bar (% checked)
- [x] Remove single item (X button)
- [x] Clear All button (wipes full list + localStorage, confirm-guarded)
- [x] Empty state placeholder
- [x] localStorage persistence across reloads
- [x] manifest.json (standalone, portrait, themed)
- [x] sw.js registered from index.html, caches core shell

## Known Gaps / Next Steps
1. Icons missing: manifest.json references /icons/icon-192.png, icon-512.png, and two maskable variants. These PNG files do NOT exist yet — must be generated/uploaded next, or manifest will show console warnings on Vercel.
2. No edit-item capability yet (only add/remove/clear-all) — candidate for M2.
3. No categories/sorting — candidate for M2.
4. No install-prompt UI (beforeinstallprompt capture) — candidate for M2.
5. Currency is now hardcoded to RM per this request — revisit if multi-currency needed later.
6. sw.js cache list does not include icon paths yet — update once icons exist.

## Deployment Notes (Vercel, mobile-only workflow)
- Static site, zero build step required — Tailwind loaded via CDN script tag, no npm/build config needed.
- Deploy root must contain: index.html, app.js, manifest.json, sw.js at same level (relative paths, no leading slash mismatches).
- After deploy, verify sw.js registers over HTTPS (Vercel serves HTTPS by default — required for service workers).
- If testing on a device that previously cached the old currency symbol version, hard-refresh or clear the SW cache to see RM formatting.

## Next Prompt Should Request
- Icon set generation (192/512 + maskable) OR user uploads existing icons to be wired in.
- OR proceed to M2 feature set (edit items, categories, install prompt).
