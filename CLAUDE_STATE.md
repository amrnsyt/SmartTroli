# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout. The
grocery list itself is the app's primary screen; adding items is a secondary action reached via
a floating button.

## Phase Roadmap
- **Phase 1–2.10 (complete)**: see prior builds — settlement engine, Gemini-only scratchpad,
list-first layout, `gemini-3.5-flash` model fix, `vercel.json` maxDuration nesting.
- **Phase 2.15 (complete, discovered this build)**: client-side receipt image compression
(`compressImageForUpload()` in `app.js`) added ahead of Phase 3 to dodge Vercel's 4.5MB
serverless request-body limit — canvas downscale to 1600px long edge + JPEG quality stepping
down to keep base64 under ~3.2MB.
- **Phase 3 (COMPLETE — this build)**: Gemini Vision receipt scanning.
  - `app.js` already had the *entire* client-side flow built (source sheet → camera/gallery →
compress → scanning overlay → POST `/api/match-receipt` → result modal → price-apply via
`State.updateItem()`) — this was done in an earlier session not reflected in the previous
version of this file.
  - **Bug fixed this build**: `/api/match-receipt.js` (written last session) didn't match what
`app.js` actually sends/expects, causing a live 400 in production:
    1. `app.js` posts the **full data URL** (`data:image/jpeg;base64,...`) as `image`. The
old endpoint forwarded that whole string into Gemini's `inline_data.data`, which only accepts
raw base64 — hence `"Base64 decoding failed for \"data:image/jpeg;base64,...\""`. Fixed by
stripping everything before the first comma server-side.
    2. `app.js` posts `items: [{id, name}]`, not a flat name list — old endpoint expected
`itemNames: string[]`. Fixed to read `items[].name` for the prompt and keep `items[].id`
around for matching.
    3. `app.js`'s `handleReceiptFile()`/`showReceiptResult()` expect the response as
`{ matches: [{itemId, price}], extras: [{name, price}] }`. Old endpoint returned
`{ matched: [{listName, receiptName, price}], unmatched: [{name, price}] }` — different keys
entirely, so even a successful Gemini call would have rendered nothing. Fixed to emit
`matches`/`extras` with the exact shape `app.js` reads.
  - `vercel.json` already had `"api/match-receipt.js": { "maxDuration": 30 }` pre-provisioned
— no change needed. In-file `AbortController` stays at 22s (nested under the 30s budget,
matching the pattern used by `parse-list.js`/`health.js`).
  - `sw.js` `CACHE_NAME` bumped `v15 → v16` this build so the "New version available" toast
fires for users on the old client once this deploy goes live (the fix only touched an
`/api/` file, which the service worker never caches, so nothing else *forced* a bump — bumping
is still done here since `sw.js` itself changed).
- **Phase 4 (polish, not started)**: turning "extras" (receipt items not in the list) into a
tappable "+ Add to list" action instead of read-only display; discount/rounding tied to
receipt scans; out-of-list item popup tagging.

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
/index.html            -> App shell. Receipt-scan UI markup (source sheet, scanning overlay,
                           result modal) present and fully wired via app.js.
/app.js                 -> State, renderAll(), findOrCreatePerson(), settlement engine, Edit/
                           Adjustments modals, Gemini connection check, toast(), swipe gestures,
                           addSheet, Gemini-only parseWithGemini(), and the full Phase 3 receipt
                           flow: compressImageForUpload(), handleReceiptFile(),
                           showReceiptResult(). Unchanged this build — bug was server-side.
/api/parse-list.js      -> Vercel fn. Gemini scratchpad parser. Model: gemini-3.5-flash.
/api/health.js          -> Gemini connection check. Model: gemini-3.5-flash.
/api/match-receipt.js   -> FIXED this build. Gemini Vision receipt scan. Now strips the data-URL
                           prefix before sending to Gemini and returns
                           {matches:[{itemId,price}], extras:[{name,price}]} to match app.js.
/manifest.json           -> unchanged
/sw.js                   -> CACHE_NAME bumped v15 -> v16 this build.
/vercel.json             -> unchanged (maxDuration for match-receipt already present).
/icons/*.png             -> unchanged
/CLAUDE_STATE.md         -> this file
```

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). All three API files
(`parse-list.js`, `health.js`, `match-receipt.js`) call `gemini-3.5-flash`. If any start
404ing, check the deprecations page and update the model string in all three.

## Timeout Budget
```
Vercel functions.maxDuration (vercel.json)   parse-list: 30s | health: 15s | match-receipt: 30s
  └─ In-file AbortController (api/*.js)      parse-list: 22s | health: 10s | match-receipt: 22s
       └─ Client fetch AbortController (app.js)  scratchpad: 25s | connection: 12s | receipt: 25s
```
Keep server in-file timeout < maxDuration < client timeout, or the outer layer kills the
request with a raw error before the inner layer can return clean JSON.

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
The "New version available" toast (`index.html`) only fires when `sw.js`'s own byte content
changes, because that's what `reg.update()` diffs — it does NOT check `app.js`/`index.html`
directly. **Whenever a deploy changes `app.js`, `index.html`, or `manifest.json`, bump
`CACHE_NAME` in `sw.js` in the same deploy**, even if `sw.js`'s logic itself didn't otherwise
change — the version-string bump is what makes the byte diff exist. Deploys that only touch
`/api/*` files don't strictly need a bump (API routes bypass the cache entirely), but bumping
anyway (as done this build) is a safe default when in doubt.

## Known Gaps / Next Steps
1. **Phase 4**: make "extras" (unmatched receipt items) tappable to add straight into the list.
2. Gemini model string hardcoded in 3 files — consider `gemini-flash-latest` alias.
3. Shared-item cost still splits evenly across all people — no custom ratio.
4. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
5. `appToast` and `updateToast` share screen position — low-priority stacking issue.
6. FAB vertical offset is a fixed estimate — worth re-checking on-device for overlap.

## Setup Reminder
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed — `match-receipt.js` reuses the same key.

## Next Prompt Should Confirm
- Confirm receipt scan now works end-to-end on-device after this deploy.
- Move to Phase 4 (tappable "extras" → add to list) or another polish item from Known Gaps?
