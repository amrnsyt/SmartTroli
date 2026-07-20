# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout. The
grocery list itself is the app's primary screen; adding items is a secondary action reached via
a floating button.

## Phase Roadmap
- **Phase 1–2.15 (complete)**: settlement engine, Gemini-only scratchpad, list-first layout,
`gemini-3.5-flash` model fix, `vercel.json` maxDuration nesting, client-side receipt image
compression (`compressImageForUpload()`).
- **Phase 3 (complete)**: Gemini Vision receipt scanning — `/api/match-receipt.js` fixed to
match `app.js`'s actual contract (strips data-URL prefix, returns
`{matches:[{itemId,price}], extras:[{name,price}]}`). Confirmed working on-device: 5 items
matched/priced, 10 extras correctly surfaced.
- **Phase 4 (THIS BUILD — complete)**: Tappable "extras". Receipt line items that don't match
anything already in the list are no longer read-only — each row in the "On receipt but not in
your list" section now has a "+ Add" button. Tapping it calls `State.addItem(name, price, 'me',
'cash', null, '', '')` (qty left `null`/TBD since a receipt gives price, not a countable qty),
re-renders the main list, and swaps that row's button for an "Added ✓" tag so it can't be
double-added. Implemented entirely inside `showReceiptResult()` in `app.js` — matched-items
rendering is unchanged (still a static, read-only list since their price was already applied
the moment the scan returned).
- **Phase 5 (not started, candidates)**:
  - Custom shared-split ratios (currently always split evenly across all people).
  - Cash-advance nudge for auto-created people (salutation-detected people start at RM 0.00).
  - Investigate duplicate-match behavior: if a receipt has two separate line items that both
fuzzy-match the same list entry (observed on-device: two "CARROT" receipt lines both matched
the shopper's single "CARROT" item), the second `State.updateItem()` call silently overwrites
the first's price. Not currently harmful (last-scanned price wins, which is usually the
correct/most recent one) but worth a decision: sum them, keep first, or surface a "matched
twice" warning.
  - `appToast`/`updateToast` shared screen position; FAB vertical offset on-device check.

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
/index.html            -> App shell + full receipt-scan UI markup. Unchanged this build.
/app.js                 -> UPDATED this build. showReceiptResult() rewritten: extras render
                           into a dedicated <ul id="receiptExtrasList"> populated via DOM
                           methods (not innerHTML string-join) so each row can carry its own
                           "+ Add" click handler. Everything else unchanged from Phase 3.
/api/parse-list.js      -> Gemini scratchpad parser. Model: gemini-3.5-flash. Unchanged.
/api/health.js          -> Gemini connection check. Model: gemini-3.5-flash. Unchanged.
/api/match-receipt.js   -> Gemini Vision receipt scan. Unchanged this build (fixed last build).
/manifest.json           -> unchanged
/sw.js                   -> CACHE_NAME bumped v16 -> v17 this build (app.js changed).
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

## Data Model (unchanged)
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital' }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`.

## Service Worker Update-Popup Policy — IMPORTANT
The "New version available" toast only fires when `sw.js`'s own byte content changes, since
that's what `reg.update()` diffs — it does NOT check `app.js`/`index.html` directly.
**Whenever a deploy changes `app.js`, `index.html`, or `manifest.json`, bump `CACHE_NAME` in
`sw.js` in the same deploy.** Current: `v17`.

## Known Gaps / Next Steps
1. Duplicate-match price overwrite behavior (see Phase 5 notes above) — decide on a policy.
2. Gemini model string hardcoded in 3 files — consider `gemini-flash-latest` alias.
3. Shared-item cost still splits evenly across all people — no custom ratio.
4. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
5. `appToast` and `updateToast` share screen position — low-priority stacking issue.
6. FAB vertical offset is a fixed estimate — worth re-checking on-device for overlap.

## Setup Reminder
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed.

## Next Prompt Should Confirm
- Confirm tappable "+ Add" on receipt extras works on-device after this deploy.
- Pick a Phase 5 item: duplicate-match policy, custom split ratios, or cash-advance nudge?
