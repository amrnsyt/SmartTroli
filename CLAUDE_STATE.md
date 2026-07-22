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
- **Phase 10 step 3 (complete)**: Manual "Skip Gemini (use local OCR)" toggle for receipt
scanning, sticky across scans in the Receipt Source Sheet. `sw.js` -> v23.
- **Phase 10 step 4 (THIS BUILD — complete)**: Custom shared-split ratios ("Share ratio").
  - **Trigger**: Known Gap #2 — shared/Kongsi items always split perfectly evenly across every
person regardless of household size/age/appetite (e.g. a young child shouldn't carry a full
adult share of the shared grocery bill).
  - **Implementation**:
    - Data model: `Person` gains `shareWeight: number` (default `1` = old even-split
behavior). Existing localStorage records without this field are treated as weight `1` via a
new `State.personWeight(person)` helper — no migration/version bump needed, same
backward-compatible pattern already used for `item.scanned`.
    - `State.totalWeight()` sums every person's weight (guards against a divide-by-zero if
every weight were somehow 0, falling back to a plain headcount).
    - `State.settlement()`: every `sharedCashTotal / peopleCount`-style **even** division was
replaced with `sharedCashTotal * (personWeight / totalWeight)` — a **weighted** split. Weight
`1` for everyone reproduces the exact old even-split math, so this is non-breaking by default.
    - `State.addPerson()` / `findOrCreatePerson()` now default new people to `shareWeight: 1`.
    - `index.html`: Person Modal gains a "Share ratio (weight)" number input
(`#personShareWeight`) with a helper caption ("child = 0.5, bigger household = 2" style
guidance). `personName`/`personCash` gained `disabled:opacity-50` styling since Phase 10 step
4 also disables them when editing "Me" (see below).
    - `app.js`:
      - `openPersonModal(person, isNudge)`: now also handles `person.isMe` — title becomes
"Your Share Ratio", `personName`/`personCash` inputs are `disabled` (name is fixed, cash
advance doesn't apply to yourself), but `personShareWeight` stays editable so "Me" can also
carry a custom ratio, not just other family members.
      - `renderPeopleChips()`: the "Me" chip is now tappable too (previously `disabled`,
Me had no editable fields at all). Every chip shows a `· 2x`-style badge next to the name
whenever that person's weight isn't the default `1`, so custom ratios are visible at a glance
without opening the modal.
      - `personSaveBtn` handler rewritten to branch on `existing.isMe` (weight-only update, no
name/cash change) vs a normal person (name + cash advance + weight, unchanged validation).
      - Settlement modal (`settleBtn` handler): shows a short green info banner ("Shared items
are split by each person's custom ratio, not evenly...") whenever any person's weight differs
from `1`, so the settlement result doesn't look like a bug when it no longer matches a naive
even split.
  - **No API changes** — this is a pure client-side (`index.html` + `app.js`) data-model +
settlement-math + UI addition. No new dependencies, no server-side files touched.
  - `sw.js` `CACHE_NAME` bumped `v23` -> `v24` since `app.js` and `index.html` both changed.
- **Phase 10 (remaining candidates)**: none currently queued — Phase 10's original gap list
(steps 1–4) is now fully implemented. Awaiting on-device testing (see "Known Gaps" /
"Next Prompt Should Confirm" below) before considering this phase fully closed.

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
/index.html            -> UPDATED this build. Person Modal gained #personShareWeight input +
                           caption; personName/personCash gained disabled:opacity-50 styling.
/app.js                 -> UPDATED this build. Phase 10 step 4: State.personWeight() /
                           totalWeight() helpers, settlement() switched from even division to
                           weighted division, addPerson()/findOrCreatePerson() default weight
                           1, openPersonModal()/personSaveBtn handle "Me" weight-only editing,
                           renderPeopleChips() makes Me tappable + shows "Nx" weight badges,
                           settleBtn handler shows a custom-ratio info banner when relevant.
                           (Phase 10 steps 1-3 code from prior builds — Undo button,
                           cash-advance nudge queue, Skip Gemini toggle — also still present,
                           unchanged this step.)
/api/_gemini.js         -> unchanged this build.
/api/_lib.js             -> unchanged this build.
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> unchanged this build.
/manifest.json           -> unchanged.
/sw.js                   -> UPDATED this build. CACHE_NAME v23 -> v24 (app.js + index.html
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
Person = { id, name, isMe: boolean, cashAdvance: number, shareWeight: number }
                 // shareWeight added Phase 10 step 4. Default 1 = equal split (old
                 // behavior). Missing on older records -> treated as 1 via
                 // State.personWeight(), no migration needed.
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`. `shareWeight` was added to the existing `PEOPLE_KEY` schema
without a version bump — same backward-compatible pattern as `item.scanned` (missing field
treated as a safe default at read-time, never written by force to old records until the user
actually edits that person).

## match-receipt.js Response Shape (unchanged, for reference)
```
{
  matches: [{ itemId: string, price: number, receiptName: string }],
  extras:  [{ name: string, price: number }]
}
```

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Last
bumped: `v24` (this build — app.js + index.html changed).

## Known Gaps / Next Steps
1. ~~No way to send a mis-scanned Bought item back to To Buy short of edit/delete.~~ RESOLVED
Phase 10 step 1 (Undo button).
2. ~~Shared-item cost still splits evenly across all people — no custom ratio.~~ RESOLVED this
build (Phase 10 step 4 — Share ratio field per person, including "Me").
3. ~~Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge
yet.~~ RESOLVED Phase 10 step 2 (cash-advance nudge queue).
4. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.
5. Local OCR fallback (Phase 9 step 3) is still untested against a real receipt photo — accuracy
of the trailing-price regex against real-world OCR noise (misread decimals, missing spaces)
should be verified on-device before relying on it.
6. ~~Consider a manual "skip Gemini, use local OCR" option...~~ RESOLVED Phase 10 step 3.
7. Phase 10 step 1's Undo action has not yet been tested on-device against a real scanned item.
8. Phase 10 step 2's cash-advance nudge queue has not yet been tested on-device with a real
multi-person scratchpad parse.
9. Phase 10 step 3's "Skip Gemini" toggle has not yet been tested on-device.
10. New this build: Phase 10 step 4's Share ratio field has not yet been tested on-device —
confirm (a) tapping the "Me" chip opens the modal with name/cash disabled but weight editable,
(b) setting a non-1 weight on a family member correctly changes their settlement instruction
amounts vs. the old even split, (c) the "Nx" badge shows/hides correctly on chips, and (d) the
settlement modal's custom-ratio info banner only appears when at least one weight isn't 1.

## Setup Reminder
`GEMINI_API_KEY` (or `GEMINI_API_KEYS`) must be set in Vercel → Settings → Environment
Variables. No setup needed for Tesseract.js — it's CDN-loaded automatically only if/when the
fallback path triggers (automatically on failure, or manually via the Skip Gemini toggle).

## Next Prompt Should Confirm
- Test Phase 10 step 4 (Share ratio) on-device: set a family member to e.g. 0.5x and another
to 2x, add a shared item, open "Arahan Malas", confirm the split reflects the custom ratio
(not an even split) and the info banner appears.
- Test the "Skip Gemini" toggle (Phase 10 step 3) on-device.
- Test the cash-advance nudge queue (Phase 10 step 2) on-device with a multi-person scratchpad
paste.
- Test the Undo action (Phase 10 step 1) on-device.
- Test the local OCR fallback accuracy on-device with a real receipt photo.
- Also still pending from Phase 9 step 2: verify the two-call Gemini match path itself
end-to-end on a real receipt.
