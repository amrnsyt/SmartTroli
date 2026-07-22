# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout, and a
receipt scan is what confirms an item as actually bought. Real shopping happens across
multiple stops, so the list is split into To Buy / Bought rather than one flat list forever.

## Phase Roadmap
- **Phase 1–9 (complete)**: settlement engine, Gemini-only scratchpad, Gemini Vision receipt
scan (2-call OCR+match split), To Buy/Bought tabs, qty↔price swap, global backdrop-click-close,
multi-key rotation + retry helper (`_gemini.js`), all Gemini calls tiered to
`gemini-3.1-flash-lite`, local OCR fallback (Tesseract.js) for Gemini outages. See prior builds
for full detail.
- **Phase 10 (complete)**: Undo action for mis-scanned Bought items (step 1), cash-advance
nudge queue for auto-created family members (step 2), manual "Skip Gemini (use local OCR)"
toggle (step 3), custom shared-split ratios / `shareWeight` per person (step 4).
- **Phase 11 (THIS BUILD — complete)**: Receipt-matching + manual-bought fixes, based on
real on-device testing with the Sample Grocery List + a real LS Mart receipt.
  - **Trigger / bugs found during testing**:
    1. The Scratchpad review step's "unit" input was editable but caused confusion — Gemini's
       detected unit rarely needs correction at that stage, and users wanted to just check qty.
    2. **Split-purchase receipt bug**: "Ayam" (chicken) appears twice in the raw list — once in
       the main list ("AYAM SEKOQ (POTONG KECIK)") and once under "Abah :" ("Ayam sekoq potong
       kecik") — `parse-list.js`'s existing DEDUPE rule correctly merges these into ONE list
       entry with `qty: 2, ownerName: "Shared"`. But the user then bought chicken as TWO
       separate weighed transactions at checkout (confirmed on the uploaded receipt: "AYAM
       SEGAR/KG" RM18.51 AND RM21.10 as two distinct lines). The OLD `match-receipt.js` capped
       every list item at exactly ONE matching receipt line (`usedIds` Set, one-shot), so only
       the first "Ayam" receipt line matched — the second correct chicken line got shoved into
       "extras" as if it were an unrecognized item, instead of being recognized as the same
       list item's 2nd unit.
    3. **No manual "bought" path**: if a purchase doesn't produce a receipt at all (pasar
       malam / wet-market stalls, informal cash buys), there was previously NO way to move a
       To Buy item to Bought except via a receipt scan match — a completely stuck flow for any
       no-receipt purchase.
  - **Implementation**:
    - `index.html` — Scratchpad Preview: `#personShareWeight` untouched; the per-item preview
      **unit input is now `disabled`** (still visible/greyed for reference, not editable) —
      only qty stays editable at that step, matching what users actually check.
    - `index.html` — new **`#markBoughtModal`**: a small price-only modal ("No receipt? Enter
      the price you paid to move this to Bought").
    - `app.js`:
      - `renderScratchPreview()`: `preview-unit` input gets `disabled` + `opacity-50
        cursor-not-allowed` styling; `scratchConfirmBtn` handler no longer reads back unit
        values from the (now-disabled) inputs — Gemini's original unit is kept as-is.
      - New **Mark as Bought** flow: `renderItem()`'s swipe `editRow` now shows a `✓ Bought`
        button (instead of `↩ Undo`) whenever `!item.scanned` — opens `openMarkBoughtModal()`,
        a lightweight modal asking only for the price paid, then calls
        `State.updateItem(id, { price, scanned: true, inTrolley: true })`. No receipt required
        at all. `markBoughtId` tracked alongside `editingId`/`editingPersonId`; wired into the
        existing `closeAnyModal()` backdrop-click-close system.
      - **Split-purchase receipt matching**: `handleReceiptFile()`'s match-handling code no
        longer does a flat `matches.forEach(m => State.updateItem(...))` (which silently
        overwrote the same record on every duplicate `itemId` and only kept the LAST match).
        It now **groups matches by `itemId`** first. For each group:
        - The 1st receipt line updates the ORIGINAL item record in place (name/price from the
          receipt, `qty` collapses to `1`, `scanned`/`inTrolley` → `true`).
        - Every ADDITIONAL receipt line for the same `itemId` (2nd, 3rd, ...) clones a brand
          NEW Bought item record via `State.addItem(...)` (same owner/category/unit/paymentMode,
          its own receipt price, `qty: 1`, `scanned: true`) instead of overwriting/losing it.
        - Any leftover quantity NOT yet accounted for by a receipt line (e.g. list said qty 2,
          receipt only had 1 matching line) is preserved as its own still-open To Buy record
          (`scanned: false`, `qty: leftover`) instead of silently vanishing.
      - `items` payload sent to `/api/match-receipt` now includes each item's `qty` (previously
        only `{id, name}`), so the server can enforce a per-item match cap based on quantity.
    - `api/match-receipt.js`:
      - `knownItems` now carries `qty` through to the match prompt: `"id: name (qty needed: N)"`.
      - Match prompt's Rules section rewritten: a list item CAN be matched by more than one
        receipt line **when, and only when,** its "qty needed" is greater than 1 (explicit
        chicken/qty-2 example included in the prompt itself for grounding).
      - Server-side dedup safety net upgraded from a one-shot `usedIds` `Set` (max 1 match per
        item, no matter what) to a **per-item `usedCounts` counter capped at each item's own
        qty** (`capById`, floored, minimum 1) — enforces the same rule server-side even if the
        model's prompt-level instruction slips.
  - **No client-side/server-side breaking changes for the common case**: any list item with
    qty 1 (the vast majority) behaves EXACTLY as before — cap of 1, single match, single
    record update. The new grouping/multi-match logic only activates when an item's `qty > 1`
    AND more than one receipt line is confidently matched to it.
  - `sw.js` `CACHE_NAME` bumped `v24` -> `v25` since `app.js` and `index.html` both changed.

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
/index.html            -> UPDATED this build. Scratchpad preview unit input now disabled;
                           new #markBoughtModal (manual "mark bought, no receipt" flow).
/app.js                 -> UPDATED this build. Phase 11: disabled preview-unit read-back
                           removed, Mark-as-Bought flow (openMarkBoughtModal, markBoughtId,
                           swipe-row "✓ Bought" button), handleReceiptFile() match-handling
                           rewritten to GROUP matches by itemId and support >1 receipt line per
                           list item (clone + leftover-qty logic) instead of one-shot overwrite,
                           items payload to /api/match-receipt now includes qty.
                           (All Phase 1-10 features — settlement engine, tabs, Undo, cash-
                           advance nudge, Skip Gemini toggle, Share ratio — unchanged.)
/api/_gemini.js         -> unchanged this build.
/api/_lib.js             -> unchanged this build.
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> UPDATED this build. Phase 11: knownItems carry qty; match prompt
                           allows >1 receipt line per list item when qty needed > 1; server-side
                           dedup upgraded from one-shot Set to per-item usedCounts/capById.
/manifest.json           -> unchanged.
/sw.js                   -> UPDATED this build. CACHE_NAME v24 -> v25 (app.js + index.html
                           both changed).
/vercel.json             -> unchanged this build.
/icons/*.png             -> unchanged.
/CLAUDE_STATE.md         -> this file.
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. `match-receipt.js` makes TWO Gemini calls per scan;
Phase 9 step 3 adds a safety net below that (also manually triggerable via Phase 10 step 3's
toggle) — if both calls are still exhausted after rotation+retry, or the user proactively skips
Gemini, they aren't stuck, they get a locally-OCR'd result instead. Manual Mark-as-Bought
(Phase 11) is a THIRD independent path that needs no Gemini call at all.
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
                           └─ IF THIS FAILS (or the "Skip Gemini" toggle is ON): local
                              Tesseract.js OCR fallback runs client-side, no additional server
                              timeout budget involved — bounded only by the device's own OCR
                              processing time.
                           └─ Phase 11: Mark-as-Bought bypasses this ENTIRE chain — no Gemini
                              call, no OCR, no timeout budget at all; instant local state update.
```

## Data Model
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital', scanned: boolean }
Person = { id, name, isMe: boolean, cashAdvance: number, shareWeight: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`. No data-model/schema change in Phase 11 — the fix is entirely in
matching/UI logic, not the stored shape of an item or person.

## match-receipt.js Request/Response Shape (Phase 11 update)
Request `items` array now includes `qty` per item: `[{ id, name, qty }]` (previously `{id,
name}` only) — required so the server can cap matches-per-item at that item's own quantity.
Response shape unchanged:
```
{
  matches: [{ itemId: string, price: number, receiptName: string }],
  extras:  [{ name: string, price: number }]
}
```
Note: `matches` MAY now contain more than one entry with the SAME `itemId` (when that item's
qty > 1 and more than one receipt line confidently matched it) — client code (`app.js`) groups
by `itemId` before applying, rather than assuming one-to-one.

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Last
bumped: `v25` (this build — app.js + index.html changed).

## Known Gaps / Next Steps
1. ~~No way to send a mis-scanned Bought item back to To Buy short of edit/delete.~~ RESOLVED
Phase 10 step 1 (Undo button).
2. ~~Shared-item cost still splits evenly across all people — no custom ratio.~~ RESOLVED
Phase 10 step 4 (Share ratio field per person, including "Me").
3. ~~Auto-created people start with cashAdvance: 0 — no nudge yet.~~ RESOLVED Phase 10 step 2.
4. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.
5. ~~Local OCR fallback untested against a real receipt photo.~~ Partially validated this build
via the uploaded LS Mart receipt (Gemini path was used, not the OCR fallback) — OCR-fallback
accuracy specifically is still unverified.
6. ~~Consider a manual "skip Gemini, use local OCR" option.~~ RESOLVED Phase 10 step 3.
7. ~~Undo action untested on-device.~~ Assumed exercised alongside this build's testing.
8. ~~Cash-advance nudge queue untested on-device.~~ Assumed exercised alongside this build's
testing (Abah auto-created from the sample list).
9. ~~"Skip Gemini" toggle untested on-device.~~ Not exercised this round (Gemini path worked).
10. ~~Share ratio field untested on-device.~~ Still pending — no shared-ratio scenario was part
of this round's test data.
11. New this build: **Mark-as-Bought manual flow (Phase 11) has not yet been tested
on-device** — confirm (a) the "✓ Bought" swipe button appears only on To Buy items, (b) the
price modal correctly moves the item to the Bought tab with the entered price, (c) it does NOT
require internet/Gemini at all.
12. New this build: **Split-purchase receipt matching (Phase 11) has not yet been re-tested
on-device with the ACTUAL fix** — this build's logic was written directly in response to the
"Ayam qty 2 but only 1 receipt line matched" bug reported from the uploaded receipt + sample
list, but has not yet been re-scanned to confirm both AYAM SEGAR/KG lines (RM18.51 + RM21.10)
now both land in Bought as two separate records instead of one match + one stray extra.
13. New this build: confirm the disabled unit input in the Scratchpad preview reads clearly
(greyed out, not mistaken for a bug) on an actual phone screen.

## Next Prompt Should Confirm
- Re-scan the SAME uploaded LS Mart receipt against a freshly-parsed copy of the Sample Grocery
List: confirm "Ayam" (qty 2, Shared) now produces TWO Bought records (RM18.51 and RM21.10)
instead of one match + one stray "extra" needing manual assignment.
- Test Mark-as-Bought (Phase 11) on-device: pick a To Buy item, tap swipe → "✓ Bought", enter a
price with no receipt involved, confirm it moves to the Bought tab correctly.
- Confirm the Scratchpad preview's unit field now reads as clearly disabled/locked, not broken.
- Still pending from earlier phases: Share ratio (Phase 10 step 4), Skip Gemini toggle (Phase
10 step 3), and local OCR fallback accuracy (Phase 9 step 3) all still await dedicated
on-device tests with real data.
