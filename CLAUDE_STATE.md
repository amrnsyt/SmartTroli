# CLAUDE_STATE.md — SmartTroli PWA

## Milestone
**M1.2: Cache-Busting Deployment + SW Update Flow** — Complete

## Stack
- Vanilla HTML5
- Tailwind CSS (CDN, config inline in index.html)
- Modular Vanilla JS (app.js — State object + render pipeline)
- localStorage persistence
- Service Worker (network-first HTML, cache-first assets, manual skipWaiting)
- vercel.json (zero-cache headers)

## File Structure
```
/index.html        -> App shell, Tailwind config/theme, header, totals, form, list mount, Clear All button, Update Toast + SW update-detection script
/app.js             -> State (CRUD + clearAll + totals), render(), event bindings, RM formatter
/manifest.json      -> PWA manifest (references /icons/icon-*.png — NOT YET GENERATED)
/sw.js              -> Offline cache, network-first HTML strategy, manual SKIP_WAITING message handler
/vercel.json        -> Cache-Control headers: max-age=0, must-revalidate on sw.js and all routes
/CLAUDE_STATE.md    -> This file
```

## Changes This Iteration
- [x] Added vercel.json with zero-cache headers on /sw.js and /(.*) as specified, so Vercel stops aggressively caching HTML/SW on redeploy
- [x] sw.js: bumped CACHE_NAME to v2, removed automatic self.skipWaiting() on install so a new SW enters "waiting" state instead of silently taking over
- [x] sw.js: added message listener for SKIP_WAITING so the new worker only activates when the user taps Refresh
- [x] sw.js: fetch handler now uses network-first for HTML navigations (falls back to cache offline) and cache-first for other core assets — prevents stale index.html from being served after deploy
- [x] index.html: added Update Toast banner ("New update available! [Refresh]") shown when reg.waiting exists on load OR a new worker finishes installing mid-session
- [x] index.html: Refresh button posts SKIP_WAITING to the waiting worker; controllerchange listener reloads the page once the new SW takes control
- [x] index.html: added setInterval(60s) reg.update() poll so long-open tabs detect new deploys without a manual navigation
- [x] Reconfirmed blank initial state and RM currency formatting are unchanged/intact from previous milestone

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
- [x] sw.js — network-first HTML, cache-first assets, manual update flow
- [x] Update Toast + Refresh-to-activate-new-SW flow
- [x] vercel.json cache headers

## Known Gaps / Next Steps
1. Icons still missing: manifest.json references /icons/icon-192.png, icon-512.png, and two maskable variants. These PNG files do NOT exist yet.
2. IMPORTANT — remember to bump CACHE_NAME in sw.js (e.g. v2 -> v3) on every future deploy that changes cached files, or the install event will just re-cache identical content and no "waiting" worker will appear.
3. No edit-item capability yet (only add/remove/clear-all) — candidate for M2.
4. No categories/sorting — candidate for M2.
5. No install-prompt UI (beforeinstallprompt capture) — candidate for M2.
6. sw.js CORE_ASSETS list does not include icon paths yet — update once icons exist.

## Deployment Notes (Vercel, mobile-only workflow)
- Static site, zero build step required.
- Deploy root must contain: index.html, app.js, manifest.json, sw.js, vercel.json all at the same level.
- vercel.json headers apply on next deploy automatically — no dashboard config needed.
- After pushing an update: bump CACHE_NAME in sw.js first, then push. Existing open tabs will show the Update Toast within ~60s (or on next navigation); tapping Refresh activates the new SW and reloads.
- Because HTML is now network-first in sw.js, first load after deploy already fetches fresh index.html when online — the update-toast flow mainly matters for the SW-cached JS/manifest assets and offline-to-online transitions.

## Next Prompt Should Request
- Icon set generation (192/512 + maskable) OR user uploads existing icons to be wired in.
- OR proceed to M2 feature set (edit items, categories, install prompt).
