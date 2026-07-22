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
- **Phase 10 step 1 (complete)**: "↩ Undo" action for a mis-scanned Bought item — swipe-reveal
button shown only when `item.scanned === true`, resets `scanned`/`inTrolley` back to false via
`State.updateItem` and shows a confirmation toast. Leaves name/price/qty/owner untouched.
`sw.js` -> v21.
- **Phase 10 step 2 (complete)**: Cash-advance nudge for auto-created family members
(salutation-header people from the scratchpad now get prompted once to set a real cash
advance instead of silently sitting at RM 0.00). `sw.js` -> v22.
- **Phase 10 step 3 (THIS BUILD — complete)**: Manual "Skip Gemini (use local OCR)" toggle
for receipt scanning.
  - **Trigger**: Known Gap #6 — a user who already knows they're offline or out of Gemini
quota had to wait out the full ~40s Gemini attempt + timeout on every scan before the local
Tesseract.js fallback (Phase 9 step 3) ever kicked in, even though they knew in advance it
would fail.
  - **Implementation**:
    - `index.html`: added a toggle row (`#receiptSourceLocalToggle` + status dot
`#receiptSourceLocalToggleDot`) inside the existing Receipt Source Sheet, below the Take
Photo / Upload from Gallery buttons, with a one-line explainer of what it does. Also gave the
scanning overlay's label its own id (`#receiptScanningLabel`) so it can be swapped to "Reading
receipt locally (OCR)…" during a forced-local scan.
    - `app.js`:
      - New module-level `forceLocalOcr` boolean + `setLocalOcrToggle(active)` helper that
flips the flag, restyles the toggle row (green border/dot when on), and is called once on
init (`setLocalOcrToggle(false)`) so it always starts OFF on a fresh load. The flag is
**sticky across scans** within a session (not reset after each scan) — a user shopping through
a known outage/quota day shouldn't have to re-toggle it every single receipt.
      - `handleReceiptFile()`: after the existing client-side image compression step, if
`forceLocalOcr` is true it now branches immediately into `runLocalOcrFallback()` (the same
Tesseract.js function Phase 9 step 3 already built) and calls `showReceiptResult([], extras,
true)` — skipping the `/api/match-receipt` fetch, its 40s AbortController, and the "Gemini
unavailable, trying local OCR fallback…" toast entirely. Falls back to the existing
try/catch/Gemini path unchanged when the toggle is off.
      - `el.scanReceiptBtn` click handler: if the device is offline AND the toggle is off, it
now still opens the source sheet (instead of just toasting and stopping) with a toast nudging
the user toward the Skip Gemini toggle, since that toggle is the actual way to proceed while
offline.
      - `showReceiptResult()`: the `usedFallback` banner copy was made source-agnostic ("Used
local OCR instead of Gemini" rather than "Gemini was unreachable") since it now covers both
the automatic failure path and this new manual path; the "no items found" message also now
attributes itself to Local OCR vs Gemini correctly depending on which path ran.
  - **No API/schema/data-model changes** — pure `index.html` + `app.js` UI/behavior addition
on top of the existing Phase 9 step 3 local-OCR machinery. No new dependencies.
  - `sw.js` `CACHE_NAME` bumped `v22` -> `v23` since `app.js` and `index.html` both changed.
- **Phase 10 (remaining candidates, not started)**:
  - Custom shared-split ratios (currently splits evenly across all people).

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: 45s)
- Vercel Node.js Serverless Functions in `/api/` — all CommonJS
- **Tesseract.js** (client-side, CDN-loaded on demand only) — Phase 9 step 3's automatic
outage fallback AND Phase 10 step 3's manual "Skip Gemini" toggle both route through the same
`runLocalOcrFallback()` function. Not a bundled dependency; no build-step impact, no npm
install needed anywhere (pure `<script src>` injection at runtime in the browser).

## File Structure
```
/index.html            -> UPDATED this build. Receipt Source Sheet gained the
                           #receiptSourceLocalToggle row + #receiptSourceLocalToggleDot, and
                           the scanning overlay label got id #receiptScanningLabel.
/app.js                 -> UPDATED this build. Phase 10 step 3: forceLocalOcr flag +
                           setLocalOcrToggle(), handleReceiptFile() branches straight to
                           runLocalOcrFallback() when the toggle is on (skips the Gemini fetch
                           entirely), scanReceiptBtn offline handling nudges toward the
                           toggle instead of just blocking, showReceiptResult() banner/empty
                           copy made source-agnostic. (Phase 10 steps 1-2 code from prior
                           builds — Undo button, cash-advance nudge queue — also still
                           present, unchanged this step.)
/api/_gemini.js         -> unchanged this build.
/api/_lib.js             -> unchanged this build.
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> unchanged this build.
/manifest.json           -> unchanged.
/sw.js                   -> UPDATED this build. CACHE_NAME v22 -> v23 (app.js + index.html
                           both changed).
/vercel.json             -> unchanged this build.
/icons/*.png             -> unchanged.
/CLAUDE_STATE.md         -> this file.
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. Phase 9 step 2's match-receipt.js makes TWO Gemini
calls per scan; Phase 9 step 3 adds a safety net below that (now also manually triggerable via
Phase 10 step 3's toggle) — if both calls are still exhausted after rotation+retry, or the user
proactively skips Gemini, they aren't stuck, they get a locally-OCR'd result instead.
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
                           └─ IF THIS FAILS (or the "Skip Gemini" toggle is ON, Phase 10 step
                              3 — in which case it's the ONLY path, no Gemini call happens at
                              all): local Tesseract.js OCR fallback runs client-side, no
                              additional server timeout budget involved — bounded only by the
                              device's own OCR processing time.
```

## Data Model
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital', scanned: boolean }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`. No new fields/keys added for Phase 10 step 3 — `forceLocalOcr` is
an in-memory UI flag only (`app.js`), not persisted to localStorage; it resets to `false` on a
fresh page load by design.

## match-receipt.js Response Shape (unchanged, for reference)
```
{
  matches: [{ itemId: string, price: number, receiptName: string }],
  extras:  [{ name: string, price: number }]
}
```

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Last
bumped: `v23` (this build — app.js + index.html changed).

## Known Gaps / Next Steps
1. ~~No way to send a mis-scanned Bought item back to To Buy short of edit/delete.~~ RESOLVED
Phase 10 step 1 (Undo button).
2. Shared-item cost still splits evenly across all people — no custom ratio.
3. ~~Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge
yet.~~ RESOLVED Phase 10 step 2 (cash-advance nudge queue).
4. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.
5. Local OCR fallback (Phase 9 step 3) is still untested against a real receipt photo — accuracy
of the trailing-price regex against real-world OCR noise (misread decimals, missing spaces)
should be verified on-device before relying on it. Now doubly relevant since Phase 10 step 3
makes this path manually reachable too, not just an automatic failure fallback.
6. ~~Consider a manual "skip Gemini, use local OCR" option so a user who already knows they're
offline doesn't have to wait out the full ~40s Gemini timeout first.~~ RESOLVED this build
(Phase 10 step 3 — Skip Gemini toggle in the Receipt Source Sheet).
7. Phase 10 step 1's Undo action has not yet been tested on-device against a real scanned item
— confirm the swipe-reveal row correctly shows Undo+Edit+Delete together without
crowding/overflow on a small screen width.
8. Phase 10 step 2's cash-advance nudge queue has not yet been tested on-device with a real
multi-person scratchpad parse (e.g. a list with both "Abah :" and "Mak:" sections in one
paste) — confirm the modal correctly queues and re-opens for the second person immediately
after the first is saved/skipped, without any UI flash/overlap.
9. New this build: the "Skip Gemini" toggle (Phase 10 step 3) has not yet been tested
on-device — confirm (a) toggling it on and scanning a real receipt photo correctly skips
straight to Tesseract with no network call attempted, (b) the toggle stays on across multiple
scans in the same session as intended, and (c) the offline + toggle-off scanReceiptBtn nudge
toast is legible/timed well on a small screen.

## Setup Reminder
`GEMINI_API_KEY` (or `GEMINI_API_KEYS`) must be set in Vercel → Settings → Environment
Variables. No setup needed for Tesseract.js — it's CDN-loaded automatically only if/when the
fallback path triggers (automatically on failure, or manually via the Skip Gemini toggle).

## Next Prompt Should Confirm
- Test the "Skip Gemini" toggle (Phase 10 step 3) on-device: turn it on in the Receipt Source
Sheet, scan a real receipt, confirm no Gemini network call is attempted (check dev tools /
network activity if possible) and the results modal shows the local-OCR banner with
assignable extras.
- Test the cash-advance nudge queue on-device: paste a scratchpad list with 2+ new salutation
sections in one go, confirm the Person modal pops up once per new person in sequence, and that
Cancel/backdrop-dismiss on one correctly advances to the next instead of getting stuck.
- Test the Undo action on-device: scan/mark an item as Bought, swipe it, tap "↩ Undo", confirm
it reappears correctly in the To Buy tab with its data intact.
- Test the local OCR fallback accuracy on-device with a real receipt photo (both the automatic
failure path and the new manual toggle path) — check how usable the auto-extracted extras are.
- Also still pending from Phase 9 step 2: verify the two-call Gemini match path itself
end-to-end on a real receipt (OCR accuracy, abbreviated-name matching, dedup behavior).
