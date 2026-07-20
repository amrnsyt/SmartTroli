# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout. The
grocery list itself is the app's primary screen; adding items is a secondary action reached via
a floating button.

## Phase Roadmap
- **Phase 1 (complete)**: People/ownership tags, cash-advance wallet, payment-mode tracking,
local settlement engine, swipe gestures, offline-first PWA shell.
- **Phase 2 (complete)**: Gemini 1.5 Flash scratchpad parsing via `/api/parse-list.js`.
- **Phase 2.5–2.7 (complete)**: Qty-first data model, health check, Edit/Toast components,
salutation/owner auto-detection, category grouping, cross-owner duplicate merging.
- **Phase 2.8 (complete)**: Gemini-only scratchpad (no offline fallback), list-first layout
rework (FAB + `#addSheet` bottom sheet).
- **Phase 2.9 (complete)**: Fixed model 404 — `gemini-1.5-flash` → `gemini-3.5-flash` in
`parse-list.js` and `health.js`. SW excludes `/api/*` from caching.
- **Phase 2.10 (complete)**: Fixed Vercel default-timeout 504s via `functions.maxDuration` in
`vercel.json` + nested `AbortController` timeouts across server/client.
- **Phase 3 (IN PROGRESS — this build)**: Gemini Vision receipt scanning.
  1. **`/api/match-receipt.js` — DONE (this build).** New serverless fn. Sends the receipt
photo + the shopper's current item names to `gemini-3.5-flash` vision, gets back
`{"items":[{"name","price"}]}`, fuzzy-matches each against the current list
(normalize → exact → substring), and returns `{ matched: [{listName, receiptName, price}],
unmatched: [{name, price}] }`. Same reason-tagged error contract as `parse-list.js`
(`config`/`input`/`api`/`parse`/`timeout`/`network`) so the client can reuse the existing
error-banner pattern. 22s in-file `AbortController`, matches the `maxDuration: 30` Vercel
already had reserved for this file in `vercel.json` (no change needed there — it was
pre-provisioned ahead of this build).
  2. **`app.js` client wiring — NOT YET DONE.** `index.html` already has all the receipt UI
markup shipped (`scanReceiptBtn`, `receiptSourceSheet` w/ camera+gallery buttons,
`receiptFileInput`/`receiptUploadInput`, `receiptScanningOverlay`, `receiptModal` w/
`receiptBody`+`receiptCloseBtn`), but none of it has listeners yet — tapping 📸 Receipt
currently does nothing. Blocked on getting the current `app.js` (and `sw.js`) source: GitHub's
raw/blob routes for those two specific files have been refusing this assistant's fetch tool
across two sessions now (index.html, vercel.json, and CLAUDE_STATE.md all fetched fine). Needs
the user to paste `app.js` + `sw.js` content directly so the wiring can be added without
guessing at existing internal function/variable names (State shape, save/render fn names,
toast fn) and risking a broken overwrite with no local debugger to catch it.
  3. **Planned client flow once unblocked**: tap Receipt → source sheet → pick file → convert
to base64 → show `receiptScanningOverlay` → POST `{image, mimeType, itemNames}` to
`/api/match-receipt.js` (12–25s client timeout, mirroring the scratchpad's nested-timeout
pattern) → hide overlay → render `receiptModal`: matched items as old→new price rows
(checked by default, applies on confirm), unmatched items as optional "+ Add to list" rows →
on confirm, write prices into `State.items`, re-render, toast the count updated.
- **Phase 4 (polish, not started)**: out-of-list item popup tagging, discount/rounding tied to
receipt scans.

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
/index.html            -> App shell. Compact header, list as primary content, FAB + #addSheet,
                           full receipt-scan UI markup already present (unwired — see Phase 3.2).
/app.js                 -> State, renderAll(), findOrCreatePerson(), settlement engine, Edit/
                           Adjustments modals, Gemini connection check, toast(), swipe gestures,
                           addSheet open/close/mode, Gemini-only parseWithGemini(). Receipt-scan
                           handlers NOT YET ADDED (Phase 3.2, blocked — see above).
/api/parse-list.js      -> Vercel fn. Gemini scratchpad parser. Model: gemini-3.5-flash.
/api/health.js          -> Gemini connection check. Model: gemini-3.5-flash.
/api/match-receipt.js   -> NEW (this build). Gemini Vision receipt scan + fuzzy match.
/manifest.json           -> unchanged
/sw.js                   -> CACHE_NAME v11. Excludes /api/* from caching. Needs a version bump
                           once app.js changes land in Phase 3.2 (not bumped yet — no app.js
                           change has shipped in this build).
/vercel.json             -> Already had maxDuration:30 reserved for api/match-receipt.js —
                           pre-provisioned ahead of this build, no change needed now.
/icons/*.png             -> unchanged
/CLAUDE_STATE.md         -> this file
```

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). All three API files
(`parse-list.js`, `health.js`, `match-receipt.js`) call `gemini-3.5-flash`. If any start
404ing, check the deprecations page and update the model string in all three (it appears once
each, inside the `fetch()` URL). Consider migrating to the `gemini-flash-latest` alias later.

## Timeout Budget — applies to match-receipt.js too
```
Vercel functions.maxDuration (vercel.json)        match-receipt: 30s
  └─ In-file AbortController (api/match-receipt.js)     22s
       └─ Client fetch AbortController (app.js, once wired)   should be ~25s
```
Keep this nesting order (server in-file timeout < maxDuration < client timeout) or the outer
layer kills the request with a raw error before the inner layer can return clean JSON.

## Data Model (unchanged)
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital' }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`.

## Known Gaps / Next Steps
1. **`app.js` receipt-scan wiring** — the actual next task, blocked on getting current
`app.js`/`sw.js` content pasted in (see Phase 3.2 above).
2. Gemini model string hardcoded in 3 files — worth migrating to `gemini-flash-latest` alias.
3. Shared-item cost still splits evenly across all people — no custom ratio.
4. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
5. `appToast` and `updateToast` share screen position — low-priority stacking issue.
6. FAB vertical offset is a fixed estimate — worth re-checking on-device for overlap.

## Setup Reminder
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed for `match-receipt.js` — it reuses the same key.

## Next Prompt Should Confirm
- Paste current `app.js` + `sw.js` so Phase 3.2 (client wiring) can be completed as full-file
overwrites.
