# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout, and a
receipt scan is what confirms an item as actually bought. Real shopping happens across
multiple stops, so the list is split into To Buy / Bought rather than one flat list forever.

## Phase Roadmap
- **Phase 1–8 (complete)**: settlement engine, Gemini-only scratchpad, Gemini Vision receipt
scan, To Buy/Bought tabs, qty↔price swap, global backdrop-click-close, multi-key rotation +
retry helper (`_gemini.js`), all Gemini calls tiered to `gemini-3.1-flash-lite`, 503 overload
retry widened to two delayed attempts. See prior builds for full detail.
- **Phase 9 step 1 (complete)**: native `responseSchema` added to `parse-list.js`.
- **Phase 9 step 2 (complete)**: `match-receipt.js` split into two sequential Gemini calls
(OCR-only vision call, then a separate text-only match call with server-side `usedIds` dedup)
instead of one combined vision+match call + JS substring fuzzy matcher. `vercel.json` /
client timeout budgets bumped to fit (30s->45s server, 25s->40s client). `sw.js` -> v19.
- **Phase 9 step 3 (complete)**: local OCR fallback for a Gemini outage during receipt
scanning — ported from the `Shoppy-With-Wifey` reference project (Tesseract.js CDN-loaded on
demand, regex line-parsing, `usedFallback` notice banner in the results modal). `sw.js` -> v20.
- **Phase 10 step 1 (THIS BUILD — complete)**: "Undo" action for a mis-scanned Bought item.
  - **Trigger**: addressed Known Gap #1 / the top Phase 10 candidate — previously the only way
to correct a wrongly-matched or accidentally-scanned Bought item was Edit (which can't change
`scanned` back to false) or Delete (which loses the item entirely).
  - **Implementation**: `renderItem()` in `app.js` now renders an extra "↩ Undo" button in the
swipe-reveal `editRow` — but ONLY when `item.scanned` is true (never shown for To Buy items,
where there's nothing to undo). Tapping it calls
`State.updateItem(item.id, { scanned: false, inTrolley: false })` then `renderAll()` and shows
a confirmation toast. Deliberately does NOT touch `name`/`price`/`qty`/`unit`/`owner` — those
stay as the receipt/edit left them, since the user may still want that data (e.g. the receipt
price) after sending the item back to To Buy; they can adjust via the normal Edit modal from
there if needed.
  - **No new UI components, no new state fields, no API/schema changes** — this was a pure
`app.js` behavior addition reusing the existing swipe-reveal action row pattern (same row that
already has Edit/Delete), so it works identically in both To Buy and Bought tab contexts.
  - `sw.js` `CACHE_NAME` bumped `v20` -> `v21` since `app.js` changed again this build.
- **Phase 10 (remaining candidates, not started)**:
  - Custom shared-split ratios (currently splits evenly across all people).
  - Cash-advance nudge for auto-created people (start at RM 0.00 with no prompt to set one).
  - Manual "Use local OCR" button (skip Gemini entirely) for users who already know they're
offline/out of quota, instead of always waiting out the Gemini attempt+timeout first.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: 45s)
- Vercel Node.js Serverless Functions in `/api/` — all CommonJS
- **Tesseract.js** (client-side, CDN-loaded on demand only) — Phase 9 step 3, local OCR
fallback only. Not a bundled dependency; no build-step impact, no npm install needed anywhere
(this is a pure `<script src>` injection at runtime in the browser, not a Vercel function dep).

## File Structure
```
/index.html            -> unchanged this build.
/app.js                 -> UPDATED this build. renderItem() gained a conditional "↩ Undo"
                           button (Phase 10 step 1) for Bought (item.scanned === true) rows,
                           wired to reset scanned/inTrolley and send the item back to To Buy.
/api/_gemini.js         -> unchanged this build.
/api/_lib.js             -> unchanged this build.
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> unchanged this build.
/manifest.json           -> unchanged.
/sw.js                   -> UPDATED this build. CACHE_NAME v20 -> v21 (app.js changed).
/vercel.json             -> unchanged this build.
/icons/*.png             -> unchanged.
/CLAUDE_STATE.md         -> this file.
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. Phase 9 step 2's match-receipt.js makes TWO Gemini
calls per scan; Phase 9 step 3 adds a safety net below that — if both calls are still
exhausted after rotation+retry, the user isn't stuck, they get a locally-OCR'd result instead
of a bare error.
1. Create additional Google Cloud projects — one per extra key wanted. Keys under the SAME
project share one quota pool; this step is what actually matters.
2. In each project, enable the Gemini API and generate a key.
3. Vercel → Settings → Environment Variables: `GEMINI_API_KEYS = key1,key2,key3`
(comma-separated). Falls back to `GEMINI_API_KEY` if unset.
4. Redeploy. `health.js`'s response reports the configured key count.
5. **For a permanent fix rather than a stopgap**: enable billing on the Google Cloud
project(s) instead of/in addition to rotation.

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). As of this build: ALL Gemini calls
(`parse-list.js`, `health.js`, both calls in `match-receipt.js`) are on
`gemini-3.1-flash-lite`. Check the deprecations page before assuming this name stays current.

## Timeout Budget
```
Vercel functions.maxDuration (vercel.json)   parse-list: 30s | health: 15s | match-receipt: 45s
  └─ Total rotation budget (api/*.js -> _gemini.js)
       parse-list: 22s | health: 10s | match-receipt: 13s (OCR call) + 13s (match call)
            └─ Per-key attempt (budget / key count, floor 6s)
                 └─ Client fetch AbortController (app.js)
                      scratchpad: 25s | connection: 12s | receipt: 40s
                           └─ IF THIS FAILS: local Tesseract.js OCR fallback runs client-side,
                              no additional server timeout budget involved (Phase 9 step 3) —
                              bounded only by the device's own OCR processing time.
```

## Data Model
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital', scanned: boolean }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`. `Item.scanned` flipping back to `false` (Phase 10 step 1's Undo
action) is a normal, expected transition now — not just receipt-scan-forward one-way.

## match-receipt.js Response Shape (unchanged, for reference)
```
{
  matches: [{ itemId: string, price: number, receiptName: string }],
  extras:  [{ name: string, price: number }]
}
```

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Last
bumped: `v21` (this build — app.js changed).

## Known Gaps / Next Steps
1. ~~No way to send a mis-scanned Bought item back to To Buy short of edit/delete.~~ RESOLVED
this build (Phase 10 step 1 — Undo button).
2. Shared-item cost still splits evenly across all people — no custom ratio.
3. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
4. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.
5. Local OCR fallback (Phase 9 step 3) is still untested against a real receipt photo — accuracy
of the trailing-price regex against real-world OCR noise (misread decimals, missing spaces)
should be verified on-device before relying on it.
6. Consider a manual "skip Gemini, use local OCR" option (Phase 10 candidate) so a user who
already knows they're offline doesn't have to wait out the full ~40s Gemini timeout first.
7. New this build: the Undo action (Phase 10 step 1) has not yet been tested on-device against
a real scanned item — confirm the swipe-reveal row correctly shows Undo+Edit+Delete together
without crowding/overflow on a small screen width.

## Setup Reminder
`GEMINI_API_KEY` (or `GEMINI_API_KEYS`) must be set in Vercel → Settings → Environment
Variables. No setup needed for Tesseract.js — it's CDN-loaded automatically only if/when the
fallback path triggers.

## Next Prompt Should Confirm
- Test the new Undo action on-device: scan/mark an item as Bought, swipe it, tap "↩ Undo",
confirm it reappears correctly in the To Buy tab with its data intact.
- Test the local OCR fallback on-device: temporarily break/disable the Gemini key to force the
fallback path, scan a real receipt, and check how usable the auto-extracted extras are.
- Also still pending from Phase 9 step 2: verify the two-call Gemini match path itself
end-to-end on a real receipt (OCR accuracy, abbreviated-name matching, dedup behavior).
