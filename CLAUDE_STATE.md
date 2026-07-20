# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout, and a
receipt scan is what confirms an item as actually bought. Real shopping happens across
multiple stops, so the list is split into what's still outstanding vs what's already been
purchased and priced by a receipt, rather than one flat list forever.

## Phase Roadmap
- **Phase 1–3 (complete)**: settlement engine, Gemini-only scratchpad, Gemini Vision receipt
scan (`/api/match-receipt.js` fixed to match `app.js`'s actual `{matches,extras}` contract).
- **Phase 4 (complete, superseded by Phase 5 below)**: tappable "+ Add" on receipt extras —
replaced this build by the dropdown-assign flow, which is strictly more capable.
- **Phase 5 (THIS BUILD — complete)**: multi-stop shopping model.
  1. **New `item.scanned` flag** (`app.js` `State.addItem()` + item shape comment). `true`
means a receipt has confirmed this item as bought. Items from older localStorage without the
field read as falsy everywhere — no migration needed.
  2. **To Buy / Bought tabs** — pill toggle added to `index.html` above the list
(`#tabToBuyBtn` / `#tabBoughtBtn`), driven by `currentTab` + `setActiveTab()` in `app.js`.
`tabItems()` filters `State.items` by `!scanned` (To Buy) or `scanned` (Bought).
`renderAll()` now renders whichever set is active; category grouping still applies within
each tab. `itemCount` now reflects the active tab's count, not the global total.
  3. **FAB scoped to To Buy** — `setActiveTab()` toggles `el.addFab`'s `hidden` class; adding
new items only makes sense while still shopping, not when reviewing what's already bought.
  4. **Sort-to-bottom in To Buy** — items manually checked off (`inTrolley`) before ever being
scanned sink to the bottom of their category via a stable sort in `renderAll()`, so the top of
the list always shows what's genuinely still outstanding. Bought tab has no special sort by
design — natural scan/add order.
  5. **Qty → Price swap in `renderItem()`** — once `item.scanned` is true, the trailing badge
shows price instead of qty, and the subtitle drops the redundant price text and shows qty
there instead (if any was ever set). Non-scanned items render exactly as before (qty badge/Add
Qty button, price-or-TBD in subtitle).
  6. **Rename-on-match + auto-Bought** — `/api/match-receipt.js` now returns `receiptName` on
every match. `handleReceiptFile()` renames the matched item to the receipt's printed name (the
receipt is ground truth; the original scratchpad/manual name was only ever a guess), applies
the price, and sets `scanned: true, inTrolley: true` together — a receipt line is proof of
purchase, not just a price update.
  7. **Dropdown-assign for extras** (replaces Phase 4's flat "+ Add" button) —
`showReceiptResult()` gives each unmatched receipt line a `<select>` populated with every
remaining To Buy item plus a "+ Add as new item" option. Choosing an existing item renames +
prices + moves it to Bought, same as an auto-match. Choosing "new" creates a fresh Bought item
(qty left `null`/TBD — a receipt confirms price, not a countable qty). Once assigned, that
target is removed from every other still-open extra row's dropdown (can't double-assign the
same item), and the row collapses to an "Added to Bought as ..." tag.
  8. **Only To Buy items sent as match candidates** — `handleReceiptFile()` now sends
`State.items.filter(i => !i.scanned)` to `/api/match-receipt`, so a second/third grocery
stop's receipt can't re-match something an earlier receipt already confirmed bought.
  9. **Progress bar removed entirely** — the "IN TROLLEY X%" rail and its markup are gone from
`index.html`; `State.progressPercent()` removed from `app.js` as dead code. The To
Buy/Bought split now communicates shopping progress instead.
  10. **Global backdrop-click-to-close** — every modal (`personModal`, `settleModal`,
`editModal`, `adjustModal`, `receiptModal`, `receiptSourceSheet`) now closes on a tap outside
its card, via a shared `closeAnyModal()` + forEach listener block in `app.js`, extending the
pattern `addSheet` already had. `receiptScanningOverlay` deliberately excluded — it's an
active loading state, not user-dismissible.
- **Phase 6 (not started, candidates)**:
  - Duplicate-match policy (two receipt lines both matching one list item — currently
last-write-wins on price).
  - Custom shared-split ratios (currently always even across all people).
  - Cash-advance nudge for auto-created people.
  - "Undo"/send-back-to-To-Buy action for a mis-scanned Bought item (currently only
edit/delete are available on Bought rows).

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: 30s)
- Vercel Node Serverless Functions in `/api/`

## File Structure
```
/index.html            -> UPDATED this build. Progress-bar markup removed. To Buy/Bought tab
                           toggle added above the list. Everything else unchanged.
/app.js                 -> UPDATED this build. scanned flag, tab state + tabItems() +
                           setActiveTab(), renderAll() tab-filtering + sort-to-bottom,
                           renderItem() qty/price swap, handleReceiptFile() rename+scan+trolley
                           + To-Buy-only candidates, showReceiptResult() dropdown-assign,
                           global backdrop-click-close, State.progressPercent() removed.
/api/parse-list.js      -> unchanged.
/api/health.js          -> unchanged.
/api/match-receipt.js   -> UPDATED this build. Each match now includes receiptName.
/manifest.json           -> unchanged
/sw.js                   -> CACHE_NAME bumped v17 -> v18 this build (index.html + app.js
                           changed).
/vercel.json             -> unchanged.
/icons/*.png             -> unchanged
/CLAUDE_STATE.md         -> this file
```

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). All three API files call
`gemini-3.5-flash`. If any start 404ing, check the deprecations page and update the model
string in all three.

## Timeout Budget
```
Vercel functions.maxDuration (vercel.json)   parse-list: 30s | health: 15s | match-receipt: 30s
  └─ In-file AbortController (api/*.js)      parse-list: 22s | health: 10s | match-receipt: 22s
       └─ Client fetch AbortController (app.js)  scratchpad: 25s | connection: 12s | receipt: 25s
```

## Data Model
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital', scanned: boolean }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
`scanned` is new this build (Phase 5) — defaults to `false` in `State.addItem()`, read as
falsy for any item loaded from a pre-Phase-5 localStorage payload.
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`.

## Service Worker Update-Popup Policy — IMPORTANT
The "New version available" toast only fires when `sw.js`'s own byte content changes,
since that's what `reg.update()` diffs — it does NOT check `app.js`/`index.html` directly.
**Whenever a deploy changes `app.js`, `index.html`, or `manifest.json`, bump `CACHE_NAME` in
`sw.js` in the same deploy.** Current: `v18`.

## Known Gaps / Next Steps
1. Duplicate-match price overwrite (two receipt lines matching one list item) — no policy yet.
2. No way to send a mis-scanned Bought item back to To Buy short of edit/delete.
3. Gemini model string hardcoded in 3 files — consider `gemini-flash-latest` alias.
4. Shared-item cost still splits evenly across all people — no custom ratio.
5. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
6. `appToast` and `updateToast` share screen position — low-priority stacking issue.
7. FAB vertical offset is a fixed estimate — worth re-checking on-device for overlap.

## Setup Reminder
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed.

## Next Prompt Should Confirm
- Confirm To Buy/Bought tabs, dropdown-assign, and backdrop-close all work on-device after
this deploy.
- Pick a Phase 6 item from Known Gaps, or a fresh idea.
