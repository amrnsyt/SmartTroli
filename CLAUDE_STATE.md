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
retry helper (`_gemini.js`), all three Gemini calls tiered to `gemini-3.1-flash-lite`, 503
overload retry widened to two delayed attempts. See prior builds for full detail.
- **Phase 9 step 1 (complete)**: native `responseSchema` added to `parse-list.js`.
- **Phase 9 step 2 (THIS BUILD — complete)**: split `match-receipt.js` into two sequential
Gemini calls instead of one combined vision+match call — ports the approach from the
`Shoppy-With-Wifey` reference project (see Phase 9 analysis notes below).
  - **Call 1 — OCR only (vision)**: reads the receipt photo, returns `{name, price}` lines.
Knows nothing about the shopper's list. Uses native `responseSchema` (array of
`{name, price}`), 13s budget.
  - **Call 2 — Match only (text-only, no image)**: given the OCR'd lines + the shopper's
current To Buy list (`id: name` pairs), Gemini itself decides which receipt line maps to which
list item — handles synonyms/abbreviations/cross-language (e.g. "AYAM SEGAR/KG" -> "Ayam")
far better than the old JS substring fuzzy matcher did. Prompted as strictly one-to-one
(no list item reused across two receipt lines), 13s budget. Uses native `responseSchema`
(array of `{receiptName, price, matchedItemId|null}`).
  - **Server-side dedup safety net**: even though the match prompt instructs one-to-one
matching, the handler still tracks `usedIds` and rejects any duplicate `matchedItemId` claim
(demoted to an "extra" instead) — this was the actual root cause of the old duplicate-match
bug, and is now guarded structurally rather than trusted to prompt-following alone.
  - **Response shape unchanged**: still returns `{matches: [{itemId, price, receiptName}],
extras: [{name, price}]}` — zero changes needed in `app.js`'s `handleReceiptFile()` /
`showReceiptResult()` consumers.
  - **Graceful degradation**: unreadable photo -> OCR call returns `[]` -> responds
`{matches:[], extras:[]}` immediately (skips the match call entirely, saves a request). Empty
To Buy list -> skips the match call, everything OCR'd becomes an extra. Match call returning
nothing parseable -> every OCR'd line falls back to "extra" rather than the whole scan
silently failing.
  - **Timeout budget bumped to fit two sequential calls**: `vercel.json`'s
`match-receipt.js` `maxDuration` raised 30s -> 45s. `app.js`'s client-side
`AbortController` timeout for the receipt-scan fetch raised 25s -> 40s to match (worst case:
13s OCR + 13s match + network/compression overhead ≈ 26-30s, 40s leaves headroom without
making a genuinely failed request hang too long).
  - `sw.js` `CACHE_NAME` bumped `v18` -> `v19` since `app.js` changed this build.
- **Phase 9 step 3 (not started)**: local-fallback resilience for a Gemini outage during
receipt scanning (Tesseract OCR + regex, per the `Shoppy-With-Wifey` reference project) — next
up per the user's stated priority order.
- **Phase 10 (not started, candidates)**:
  - Phase 9 step 3 (see above).
  - "Undo"/send-back-to-To-Buy action for a mis-scanned Bought item.
  - Custom shared-split ratios; cash-advance nudge for auto-created people.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: **45s, updated this build**)
- Vercel Node.js Serverless Functions in `/api/` — all CommonJS

## File Structure
```
/index.html            -> unchanged this build.
/app.js                 -> UPDATED this build. Receipt-scan client timeout 25s -> 40s to match
                           match-receipt.js's new two-call server budget (Phase 9 step 2).
                           No other logic changed — response shape from the API is unchanged.
/api/_gemini.js         -> unchanged this build (built in Phase 6).
/api/_lib.js             -> unchanged this build — safeJsonParse() now also used inside
                           match-receipt.js's two Gemini calls (previously only parse-list.js).
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> REWRITTEN this build (Phase 9 step 2). Two sequential Gemini calls
                           (OCR-only vision call, then text-only match call) replacing the old
                           single combined vision+match call + JS substring fuzzy matcher.
                           Native responseSchema on both calls. Server-side usedIds dedup as a
                           safety net on top of the prompt's one-to-one matching rule. Response
                           shape to app.js unchanged: {matches, extras}.
/manifest.json           -> unchanged
/sw.js                   -> UPDATED this build. CACHE_NAME v18 -> v19 (app.js changed).
/vercel.json             -> UPDATED this build. match-receipt.js maxDuration 30 -> 45.
/icons/*.png             -> unchanged
/CLAUDE_STATE.md         -> this file
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. Note: Phase 9 step 2's match-receipt.js now makes
TWO Gemini calls per receipt scan instead of one — each call independently rotates across all
configured keys on 429/503 via `_gemini.js`, so a scan can now consume up to 2x the per-key
request budget it used to. Worth keeping an eye on quota headroom if 429s reappear.
1. Create additional Google Cloud projects — one per extra key wanted. Keys under the SAME
project share one quota pool; this step is what actually matters.
2. In each project, enable the Gemini API and generate a key.
3. Vercel → Settings → Environment Variables: `GEMINI_API_KEYS = key1,key2,key3`
(comma-separated). Falls back to `GEMINI_API_KEY` if unset.
4. Redeploy. `health.js`'s response reports the configured key count.
5. **For a permanent fix rather than a stopgap**: enable billing on the Google Cloud
project(s) instead of/in addition to rotation. Flash-Lite pricing is low enough that normal
usage costs a small fraction of a dollar per month.

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). As of this build: ALL Gemini calls across
all three API files (`parse-list.js`, `health.js`, and now BOTH calls in `match-receipt.js`)
are on `gemini-3.1-flash-lite`. Check the deprecations page before assuming this name stays
current.

## Timeout Budget
```
Vercel functions.maxDuration (vercel.json)   parse-list: 30s | health: 15s | match-receipt: 45s
  └─ Total rotation budget (api/*.js -> _gemini.js)
       parse-list: 22s | health: 10s | match-receipt: 13s (OCR call) + 13s (match call)
            └─ Per-key attempt (budget / key count, floor 6s)
                 └─ Client fetch AbortController (app.js)
                      scratchpad: 25s | connection: 12s | receipt: 40s (updated this build)
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
`app.js`'s `handleReceiptFile()` and `showReceiptResult()` consume this exact shape — no
client changes were needed for Phase 9 step 2 beyond the timeout bump.

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Not needed
for `/api/*`-only deploys. Last bumped: `v19` (this build — app.js changed).

## Known Gaps / Next Steps
1. Phase 9 step 3: local-fallback resilience (Tesseract OCR + regex) for a Gemini outage
during receipt scanning — next thing to build.
2. No way to send a mis-scanned Bought item back to To Buy short of edit/delete.
3. Shared-item cost still splits evenly across all people — no custom ratio.
4. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
5. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.
6. Watch Gemini quota headroom now that match-receipt.js issues 2 calls per scan instead of 1
(see Key Rotation note above) — re-open Phase 6/7/8's rotation mitigations if 429s reappear.

## Setup Reminder
`GEMINI_API_KEY` (or `GEMINI_API_KEYS`) must be set in Vercel → Settings → Environment
Variables.

## Next Prompt Should Confirm
- Test the new two-call receipt scan end-to-end on a real receipt photo (checks: OCR accuracy,
match accuracy on abbreviated names, dedup behavior with two similar items on one receipt).
- Ready to build Phase 9 step 3 (local Tesseract fallback) once step 2 is verified working?
