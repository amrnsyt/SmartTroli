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
- **Phase 9 step 3 (THIS BUILD — complete)**: local OCR fallback for a Gemini outage during
receipt scanning — last piece ported from the `Shoppy-With-Wifey` reference project.
  - **Trigger**: `handleReceiptFile()` in `app.js` now wraps the `/api/match-receipt` call in
its own try/catch. ANY failure — network error, client-side 40s timeout, or the server
returning a non-OK response (429/503 exhausted after rotation+retry, 500, 502, 504, etc.) —
falls through to the local fallback path instead of going straight to an error toast.
  - **Local fallback path**: `runLocalOcrFallback(dataUrl)` lazy-loads **Tesseract.js** from
a CDN (`cdn.jsdelivr.net/npm/tesseract.js@5`) — only injected into the page the first time a
fallback is actually needed, never on a normal happy-path scan, so there's zero extra load
cost for users whose Gemini calls are working fine. Runs OCR on the same already-compressed
`dataUrl` used for the (failed) Gemini upload attempt — no second photo/re-compress needed.
  - **Local parsing**: `parseReceiptTextLocally()` regexes the raw OCR text line-by-line —
skips lines matching a noise-word list (total/subtotal/tax/gst/sst/cash/change/discount/
rounding/points/card refs, English+Malay), then extracts a trailing price
(`\d{1,4}[.,]\d{2}$`) with everything before it (minus dot-leaders/stray punctuation) as the
item name. No AI, so no smart matching against the shopper's list is possible — every parsed
line comes back as an "extra".
  - **UI reuse, not a new UI**: local-fallback extras flow straight into the EXISTING Phase 5
dropdown-assign UI (`showReceiptResult()`) with zero new UI components — `matches` is always
`[]` in this path, `extras` holds whatever Tesseract found, and a new `usedFallback` boolean
param on `showReceiptResult()` renders a one-line orange notice at the top of the results
modal ("⚠️ Gemini was unreachable — used local OCR instead...") so the user knows accuracy is
lower and to double-check before assigning.
  - **Failure-of-failure handling**: if the local fallback ALSO fails (e.g. CDN blocked,
Tesseract itself errors), the user gets one final clear error toast rather than a silent
dead-end — this is the true "nothing worked" floor, replacing what used to be the very first
failure's floor.
  - **413 special-case removed**: the old explicit "photo too large" 413 message is gone —
that failure now falls into the same generic catch -> local-fallback-attempt path, which is
strictly better (local OCR runs client-side on the dataUrl regardless of why the upload to
Gemini failed, so even a 413 now gets a fallback attempt instead of a dead-end).
  - `sw.js` `CACHE_NAME` bumped `v19` -> `v20` since `app.js` changed again this build.
- **Phase 10 (not started, candidates)**:
  - "Undo"/send-back-to-To-Buy action for a mis-scanned Bought item.
  - Custom shared-split ratios; cash-advance nudge for auto-created people.
  - Consider a manual "Use local OCR" button (skip Gemini entirely) for users who know they're
offline/out of quota, instead of always waiting out the Gemini attempt+timeout first.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: 45s)
- Vercel Node.js Serverless Functions in `/api/` — all CommonJS
- **Tesseract.js** (client-side, CDN-loaded on demand only) — new this build, local OCR
fallback only. Not a bundled dependency; no build-step impact, no npm install needed anywhere
(this is a pure `<script src>` injection at runtime in the browser, not a Vercel function dep).

## File Structure
```
/index.html            -> unchanged this build. (Tesseract.js is injected at runtime by
                           app.js, not declared as a static <script> tag here — see Phase 9
                           step 3 notes.)
/app.js                 -> UPDATED this build. handleReceiptFile() restructured with a
                           local-OCR fallback path (Phase 9 step 3): loadTesseract(),
                           parseReceiptTextLocally(), runLocalOcrFallback() added.
                           showReceiptResult() gained a usedFallback param + notice banner.
/api/_gemini.js         -> unchanged this build.
/api/_lib.js             -> unchanged this build.
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> unchanged this build (Phase 9 step 2 build).
/manifest.json           -> unchanged.
/sw.js                   -> UPDATED this build. CACHE_NAME v19 -> v20 (app.js changed).
/vercel.json             -> unchanged this build.
/icons/*.png             -> unchanged.
/CLAUDE_STATE.md         -> this file.
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. Phase 9 step 2's match-receipt.js makes TWO Gemini
calls per scan; Phase 9 step 3 (this build) adds a safety net below that — if both calls are
still exhausted after rotation+retry, the user isn't stuck, they get a locally-OCR'd result
instead of a bare error.
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
                              no additional server timeout budget involved (this build, Phase 9
                              step 3) — bounded only by the device's own OCR processing time.
```

## Data Model
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital', scanned: boolean }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`.

## match-receipt.js Response Shape (unchanged, for reference)
```
{
  matches: [{ itemId: string, price: number, receiptName: string }],
  extras:  [{ name: string, price: number }]
}
```
The Phase 9 step 3 local fallback path produces the same client-side shape by construction
(`matches: []`, `extras: <locally parsed lines>`) so `showReceiptResult()` needed only one new
optional parameter (`usedFallback`), not a shape change.

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Last
bumped: `v20` (this build — app.js changed).

## Known Gaps / Next Steps
1. No way to send a mis-scanned Bought item back to To Buy short of edit/delete.
2. Shared-item cost still splits evenly across all people — no custom ratio.
3. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
4. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.
5. Local OCR fallback (Phase 9 step 3) is untested against a real receipt photo yet — accuracy
of the trailing-price regex against real-world OCR noise (misread decimals, missing spaces)
should be verified on-device before relying on it.
6. Consider a manual "skip Gemini, use local OCR" option (see Phase 10 candidates) so a user
who already knows they're offline doesn't have to wait out the full ~40s Gemini timeout first.

## Setup Reminder
`GEMINI_API_KEY` (or `GEMINI_API_KEYS`) must be set in Vercel → Settings → Environment
Variables. No setup needed for Tesseract.js — it's CDN-loaded automatically only if/when the
fallback path triggers.

## Next Prompt Should Confirm
- Test the local OCR fallback on-device: temporarily break/disable the Gemini key to force the
fallback path, scan a real receipt, and check how usable the auto-extracted extras are.
- Also still pending from Phase 9 step 2: verify the two-call Gemini match path itself
end-to-end on a real receipt (OCR accuracy, abbreviated-name matching, dedup behavior).
