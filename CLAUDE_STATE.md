# CLAUDE_STATE.md — SmartTroli PWA (Project Memory)

## Product Context (Why This App Exists)
SmartTroli solves the real-world chaos of Malaysian family grocery runs:
- Multiple unstructured lists from different family members get merged into one clean list, keyed in manually before entering the store.
- Physical trolley tracking via checkbox strike-out, so the eye only follows what's left on the shelf.
- Dual real-time totals prevent "budget shock" at checkout:
  1. **Total Estimated Price** — sum of every item keyed in.
  2. **Trolley Total** — sum of only checked/in-trolley items.
- Strict RM (Malaysian Ringgit) formatting throughout.
- Must survive terrible in-store network signal: all data is local-first (localStorage) and the app must load/function offline via Service Worker.

## Milestone
**M1.3: Full Architectural Rebuild — Sticky App-Shell Layout + Stale-While-Revalidate SW** — Complete

## Stack
- Vanilla HTML5
- Tailwind CSS (CDN, config inline in index.html)
- Modular Vanilla JS (app.js — reactive State object + render pipeline)
- localStorage persistence (survives refresh, screen-off, low-signal drops)
- Service Worker — stale-while-revalidate strategy, manual skipWaiting update flow
- vercel.json — zero-cache headers so deploys go live instantly

## File Structure
```
/index.html         -> App shell: sticky header (branding + Clear All + progress rail + add form),
                        scrollable center list, sticky bottom totals bar, update-toast banner + SW registration script
/app.js              -> Reactive State { id, name, estimatedPrice, inTrolley }, localStorage sync,
                        RM formatter, render(), clearAll, add/toggle/remove handlers
/manifest.json       -> PWA manifest — name "SmartTroli", start_url "/", standalone, theme color, icon set
                        (icon PNG files referenced but NOT YET GENERATED — see Known Gaps)
/sw.js               -> Stale-while-revalidate fetch strategy, message listener for 'skipWaiting' trigger
/vercel.json         -> Cache-Control: public, max-age=0, must-revalidate on /sw.js and /(.*)
/CLAUDE_STATE.md     -> This file — project memory, architecture, state rules, iteration log
```

## Data Model (State Rules)
```
Item = {
  id: string,              // timestamp + random suffix, generated on add
  name: string,             // trimmed, HTML-escaped on render
  estimatedPrice: number,   // parsed float, defaults to 0 on bad input
  inTrolley: boolean        // false on creation; toggled via checkbox
}
```
- **Source of truth**: `State.items` array held in memory during the session.
- **Persistence rule**: `State.save()` (→ localStorage under key `smarttroli_items_v1`) is called after EVERY mutation: addItem, toggleItem, removeItem, clearAll. No batched/delayed writes — every action is durable immediately.
- **Load rule**: `State.load()` runs once on script init, before first `render()`. Corrupt/missing localStorage falls back to an empty array (never crashes).
- **Blank-start rule**: No seed/demo items are ever hardcoded. Fresh installs and cleared localStorage both render the empty state ("Your trolley is empty. Add your first item above!").
- **Currency rule**: All money values pass through the single `fmt()` helper (`RM ${n.toFixed(2)}`). No other currency symbol may appear anywhere in the UI.

## Layout Rules (App-Shell)
- `body` is a fixed-height flex column (`h-screen flex flex-col overflow-hidden`) — no page-level scroll.
- **Header** (`shrink-0`, sticky by virtue of flex layout): branding, Clear All button, Trolley Rail progress bar, Add Item form. Always visible.
- **Main** (`flex-1 overflow-y-auto`): the only scrollable region — the grocery list itself.
- **Footer** (`shrink-0`): Total Estimated Price (left) + Trolley Total (right), always visible above the thumb, respects `env(safe-area-inset-bottom)` for notched devices.
- **Update toast**: fixed, floats above the footer, non-blocking.

## Service Worker Rules
- Cache name is versioned (`smarttroli-cache-v3`). **Bump this string on every deploy that changes any cached file**, or the browser will treat the new SW as identical and skip the "waiting" update flow entirely.
- Fetch strategy: **stale-while-revalidate** — cached response (if present) is served immediately for instant/offline loads, while a background fetch silently refreshes the cache for next time. Falls back to `/index.html` if both cache and network fail.
- Update activation is **manual, never automatic**: `install` does not call `skipWaiting()`. The SW sits in "waiting" state until it receives a `message` event with data `'skipWaiting'` — which only happens when the user taps "Update Now" in the toast banner.
- `controllerchange` listener in index.html reloads the page exactly once after the new SW takes control, avoiding reload loops.

## Features Implemented
- [x] Blank initial state (no seed data), empty-state placeholder copy
- [x] Add item (name + estimated price, RM) via sticky header form
- [x] Reactive list render from `State.items`
- [x] Trolley checkbox toggle → strike-through + dim (visual "cross out")
- [x] Total Estimated Price (all items) — sticky bottom-left
- [x] Trolley Total (checked items only) — sticky bottom-right
- [x] Trolley Rail progress bar (% of items checked)
- [x] Remove single item (✕ button)
- [x] Clear All button in header (confirm-guarded, wipes State + localStorage)
- [x] localStorage persistence across refresh/screen-off/reload
- [x] manifest.json — standalone display, RM-market-appropriate branding
- [x] Service Worker — stale-while-revalidate, offline-capable
- [x] Manual SW update flow — "New version available!" toast, `skipWaiting` message, auto-reload on activation
- [x] vercel.json — instant cache invalidation on redeploy for HTML + SW

## Known Gaps / Next Steps
1. **Icons missing**: `manifest.json` references `/icons/icon-192.png`, `/icons/icon-512.png`, and two maskable variants. These PNG files do not exist in the repo yet — install-to-homescreen will show a default icon or console warning until generated/uploaded.
2. **Remember**: bump `CACHE_NAME` in `sw.js` on every future deploy that changes cached files (currently `v3`), or the update-toast flow will not trigger.
3. No item editing (only add/remove/clear-all) — candidate for M2.
4. No per-family-member tagging or duplicate-detection assist — candidate for M2, ties back to the "chaotic combined lists" problem statement.
5. No explicit budget-limit warning (e.g. red state when Trolley Total nears a set ceiling) — candidate for M2, ties back to "Budget Shock" problem statement.
6. No install-prompt UI (`beforeinstallprompt` capture) — candidate for M2.

## Deployment Notes (Vercel, mobile-only / Android pipeline)
- Static site, zero build step — Tailwind via CDN, no npm/build config required.
- Deploy root must contain `index.html`, `app.js`, `manifest.json`, `sw.js`, `vercel.json` all at the same level — paths are now root-absolute (`/app.js`, `/sw.js`, `/manifest.json`) to match `start_url: "/"`.
- `vercel.json` headers apply automatically on next deploy, no dashboard config needed.
- After pushing an update: bump `CACHE_NAME` in `sw.js` first, then push from Android/git. Open tabs detect the new SW within ~60s (or on next navigation) and show the update toast; tapping "Update Now" activates it and reloads.
- Because fetch is stale-while-revalidate (not network-first), the very first paint after a deploy may still show the previous cached version for a split second before the background refresh completes — this is expected and by design for offline resilience in low-signal stores; the update toast is what surfaces "a newer version is ready."

## Iteration Log
- **M1**: Initial build — index.html, manifest.json, sw.js, CLAUDE_STATE.md; Tailwind mobile-first UI, add/toggle/remove, dual totals, Trolley Rail progress bar, cache-first SW.
- **M1.1**: Confirmed blank-start requirement; switched currency ₹ → RM; added Clear All button.
- **M1.2**: Added `vercel.json` zero-cache headers; reworked `sw.js` for manual `skipWaiting` + network-first HTML; added update-toast UI and registration logic in `index.html`.
- **M1.3 (current)**: Full rebuild against detailed product-scenario spec — sticky app-shell layout (fixed header/footer, scrollable list only), stale-while-revalidate SW strategy for true offline resilience, `skipWaiting` message string standardized, manifest `start_url` switched to root `/`, all asset paths made root-absolute, CLAUDE_STATE.md rewritten as full project memory doc with data-model and state rules.

## Next Prompt Should Request
- Icon set generation (192/512 + maskable) so `manifest.json` resolves cleanly, OR user uploads existing icons to be wired in.
- OR proceed to M2 feature set: item editing, budget-limit warning, family-member tagging/duplicate detection, install prompt.
