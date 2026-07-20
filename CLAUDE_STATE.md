# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists (mixed
salutations, dialects, no prices) into a clean, categorized, per-person shared checklist and a
single settlement instruction ("Arahan Malas"). Lists start QUANTITY-first — prices are added
at the shelf/checkout, not upfront. The grocery list itself is the app's primary screen; adding
items is a secondary action reached via a floating button, not something competing for space
with the list.

## Phase Roadmap
- **Phase 1 (complete)**: People/ownership tags, cash-advance wallet, payment-mode tracking,
  local settlement engine, swipe gestures, offline-first PWA shell.
- **Phase 2 (complete)**: Gemini 1.5 Flash scratchpad parsing via `/api/parse-list.js`.
- **Phase 2.5 (complete)**: Qty-first data model, Gemini connection health check, Edit Item
  modal + toast component (replaced `prompt()`/`alert()`), Adjustments settings UI.
- **Phase 2.6 (complete)**: Salutation/owner auto-detection, category grouping, "Add Qty" as
  the primary per-item action (price demoted to secondary/optional info).
- **Phase 2.7 (complete)**: Cross-owner duplicate merging — same item name under different
  people (or main list vs a salutation section) combines into ONE entry, quantities summed
  (unstated qty counts as 1 when merging), owner promoted to "Shared (Kongsi)".
- **Phase 2.8 (THIS BUILD — complete)**:
  1. **Scratchpad is now Gemini-only — no offline fallback.** The local regex parser
     (`localParseFallback`, `parseScratchLine`, `categorize`, etc.) has been deleted entirely.
     If Gemini can't be reached, the user sees a specific, persistent inline error explaining
     why (no internet / timeout / API error) instead of silently getting degraded local
     results. Structured (manual) add mode is unaffected and still fully offline-capable —
     this restriction is scoped to the AI scratchpad only.
  2. **Layout rework — the list is now the main event.** Header shrunk to branding + progress
     rail + people chips + action buttons only. The Add Item form and Scratchpad moved out of
     the header entirely into a bottom-sheet modal (`#addSheet`) opened via a floating "+"
     action button (FAB) above the footer. The list section got a larger "Your List" title, an
     elevated rounded card surface, and sticky category headers while scrolling.
- **Phase 2.9 (THIS BUILD — bugfix, complete)**: Fixed a hard failure — every scratchpad parse
  and every connection check was returning "Gemini API error (404)" because `/api/parse-list.js`
  and `/api/health.js` were both hardcoded to `gemini-1.5-flash`, which Google has fully shut
  down (confirmed via Google's official deprecations page — all Gemini 1.0 and 1.5 models now
  404 on every request). Both files now call `gemini-3.5-flash`, the current GA flash model as
  of this build (released May 19, 2026, no shutdown date announced). Also fixed a related bug:
  the service worker's stale-while-revalidate fetch handler was intercepting and caching GET
  `/api/health` responses, which could make the connection-status dot show a stale result on
  repeat visits — `/api/` requests now always bypass the SW cache and hit the network directly.
- **Phase 2.10 (THIS BUILD — bugfix, complete)**: Fixed a second stacked issue that showed up
  after the Phase 2.9 model fix — scratchpad parses were failing with "Gemini took too long to
  respond (timeout)". Root cause: `vercel.json` never configured `functions.maxDuration`, so
  `/api/parse-list.js` was running under Vercel's default ~10s execution limit — too short for
  a long, category-classifying Gemini prompt, especially on a cold start. Vercel would kill the
  function with a raw 504 before Gemini finished. Fixed by adding explicit `maxDuration` to
  `vercel.json` (30s for parse-list, 15s for health), adding an explicit `AbortController`
  timeout inside `parse-list.js` itself (22s, safely under its 30s budget) so a genuinely slow
  Gemini call now returns our own clean JSON error instead of Vercel's raw 504, and raising the
  client-side fetch timeouts in `app.js` (scratchpad: 12s → 25s, connection check: 8s → 12s) and
  the internal timeout in `health.js` (7s → 10s) so every layer's timeout is comfortably nested
  inside the layer above it.
- **Phase 2.11 (THIS BUILD — bugfix, complete)**: Fixed the real cause of the recurring
`/api/parse-list` 504s (confirmed via Vercel logs). It was **not** the model string —
`gemini-3.5-flash` is a valid, current GA model. The actual cause: Gemini 3.5 Flash ships
with **"thinking" ON by default** (`thinkingLevel: "medium"`), unlike the old
`gemini-1.5-flash`, which had no thinking step at all. That extra reasoning pass was adding
enough per-request latency to a categorization/JSON-extraction prompt to blow past the 22s
in-file `AbortController` and/or the 30s `vercel.json` `maxDuration`, surfacing as a raw
platform 504 instead of (or in addition to) our own clean JSON timeout error. Fixed by adding
`generationConfig.thinkingConfig: { thinkingLevel: "low" }` to both `/api/parse-list.js` and
`/api/health.js` — Gemini 3-series models can't fully disable thinking (no
`thinkingBudget: 0` equivalent like 2.5-series had), but `"low"` cuts the reasoning pass
enough to comfortably fit the existing timeout budget. Also bumped `health.js`'s
`maxOutputTokens` from 5 → 32, since thinking tokens are counted against that budget even at
low level and 5 was too tight (risk of silently truncated/empty replies).
- **Phase 3 (next — Gemini Vision)**: Photograph-a-receipt flow — `/api/match-receipt.js`.
- **Phase 4 (polish)**: out-of-list item popup tagging, discount/rounding tied to receipt scans.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow
- vercel.json — zero-cache headers
- Vercel Node Serverless Functions in `/api/`

## File Structure
```
/index.html           -> App shell — COMPACT header (branding, Clear, progress rail, people
                          chips, +Person/Adjust/Settle actions only), list as primary content
                          (elevated card, sticky category headers, larger title), floating "+"
                          add button, #addSheet bottom-sheet modal (mode switch buttons +
                          structured form + Gemini-only scratchpad w/ skeleton loader,
                          connection dot, and persistent error banner), Person/Edit/Adjust/
                          Settlement modals, generic Toast, update-toast
/app.js                -> State (items+people+adjustments), normalizeQty(), category grouping
                          in renderAll() w/ sticky headers, findOrCreatePerson(), settlement
                          engine, Edit modal, Adjustments modal, Gemini connection check,
                          toast(), swipe gestures, openAddSheet()/closeAddSheet()/setAddMode()
                          for the new bottom sheet, and a Gemini-only parseWithGemini() with
                          reason-specific error handling (offline/timeout/api/network) — NO
                          local fallback parser (removed in this build)
/api/parse-list.js     -> Vercel serverless fn. Prompt unchanged. Model: gemini-3.5-flash.
                          Phase 2.11: generationConfig now sets thinkingConfig.thinkingLevel
                          = "low" — the real fix for the recurring 504s (thinking latency,
                          not the model string, which was already correct/current).
/api/health.js         -> Gemini connection check. Same thinkingLevel: "low" fix as
                          parse-list.js. maxOutputTokens raised 5 -> 32 (thinking tokens eat
                          into this budget even at low level).
/manifest.json         -> unchanged
/sw.js                 -> CACHE_NAME bumped v9 -> v10 -> v11 (latest: app.js timeout values
                          changed). Fetch handler excludes /api/* paths from caching entirely
                          (always network-live, fixes stale health-check results).
/vercel.json           -> NOW HAS a "functions" block setting maxDuration: 30s for
                          api/parse-list.js and 15s for api/health.js (previously only had
                          cache-control "headers" — Vercel's default function timeout, ~10s,
                          was silently killing slow Gemini calls before this).
/icons/*.png           -> unchanged
/CLAUDE_STATE.md       -> this file
```

## Timeout Budget — IMPORTANT MAINTENANCE NOTE (Phase 2.10)
Every timeout in this chain must be nested correctly, outside-in, or the outer layer kills the
request with an unhelpful raw error (like a platform 504) before the inner layer gets a chance
to fail cleanly with our own JSON error message. Current chain:
```
Vercel functions.maxDuration (vercel.json)        parse-list: 30s   |   health: 15s
  └─ In-file AbortController (api/*.js)            parse-list: 22s   |   health: 10s
       └─ Client fetch AbortController (app.js)     scratchpad: 25s  |  connection: 12s
```
The ordering that matters: the **server's own in-file timeout must fire before**
`functions.maxDuration` would (22s < 30s, 10s < 15s), so the API always gets to return a clean
JSON error instead of letting Vercel kill it with a raw 504. The **client's fetch timeout is
set slightly longer** than the server's in-file timeout (25s > 22s, 12s > 10s) so that in the
normal case the server's own error response arrives and gets parsed before the client's
AbortController would fire; the client timeout only acts as a last-resort safety net for cases
where no response arrives at all (e.g. the function crashes outright). If any of these three
numbers are changed, re-verify this nesting order still holds.

## Gemini Model String — IMPORTANT MAINTENANCE NOTE (Phase 2.9)
Google retires Gemini models on an aggressive, rolling cadence (see
https://ai.google.dev/gemini-api/docs/deprecations — e.g. Gemini 2.0 Flash models were retired
June 1, 2026, and even `gemini-2.5-flash` has an October 16, 2026 shutdown date already
announced with `gemini-3.5-flash` as its replacement). Both `/api/parse-list.js` and
`/api/health.js` now call **`gemini-3.5-flash`**. If Gemini calls start failing again with a
404, check the deprecations page above for the current GA "flash" model and update both files
(the model string appears once in each, inside the `fetch()` URL). Consider migrating to the
`gemini-flash-latest` alias in a future pass so this stops requiring manual updates — Google's
own docs note this alias auto-points to the current GA flash model.

**Thinking-latency gotcha (Phase 2.11):** a 404 is not the only failure mode a model swap can
introduce. Gemini 2.5-series and later models "think" by default before replying (Gemini
3-series uses `generationConfig.thinkingConfig.thinkingLevel`, default `"medium"`; 2.5-series
used `thinkingBudget`, default dynamic). A model swap can silently turn a previously-fast
endpoint slow under the exact same code, because the model itself got slower — not because
anything actually broke. Both `/api/parse-list.js` and `/api/health.js` now explicitly set
`thinkingLevel: "low"` (Gemini 3-series can't fully disable thinking like 2.5-series could
with `thinkingBudget: 0`). If a future model swap reintroduces slowness/504s, check the new
model's thinking defaults FIRST before assuming it's a timeout-budget or network problem.

## Data Model (unchanged since Phase 2.6/2.7)
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital' }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
Storage keys unchanged this round: `smarttroli_items_v4`, `smarttroli_people_v2`,
`smarttroli_adjustments_v2`. No reset needed for this build.

## Scratchpad Is Now Gemini-Only (Phase 2.8)
- `parseWithGemini()` in `app.js` throws a specific `Error` with a `.reason` tag for each
  failure mode:
  - `navigator.onLine === false` → immediate "No internet connection" error, doesn't even
    attempt the fetch.
  - Fetch `AbortError` (12s timeout) → "Gemini took too long to respond (timeout)."
  - Non-OK HTTP response → "Gemini API error: <server message>" (surfaces the actual
    `/api/parse-list.js` error text when available).
  - Any other thrown error (DNS failure, CORS, etc.) → generic "Could not reach Gemini" network
    message.
- On failure, `showScratchError()` writes the message into a persistent `#scratchError` banner
  inside the scratchpad panel (not just a transient toast) so the user has a clear, sticky
  explanation while they're deciding what to do next. The Gemini connection dot is also
  refreshed (`checkGeminiConnection(true)`) so its color reflects the failure immediately.
- No results are ever added to the list from a failed Gemini call — there is no silent
  degraded/local parse anymore. If Gemini returns 0 items, that's also surfaced as an error
  ("Gemini could not detect any items in that text"), not a silent no-op.
- The local regex-based parser, salutation regex, keyword category dictionary, and emoji
  cleaner that used to back the offline fallback have all been **deleted** from `app.js` — they
  are no longer needed since there's no fallback path to serve.

## Layout Rework — List as Primary Content (Phase 2.8)
- **Header** now only contains: branding row + Clear button, Trolley Rail progress, People
  chips, and the +Person / ⚙️ Adjust / Arahan Malas action row. Roughly half the previous
  header height.
- **Add Item form + Scratchpad** moved into `#addSheet`, a bottom-sheet modal (slides up from
  screen bottom, `items-end` flex + `rounded-t-3xl`) opened via a new floating "+" button
  (`#addFab`, fixed bottom-right, orange, positioned to clear the footer). Inside the sheet, a
  two-button switch (`#modeStructuredBtn` / `#modeScratchBtn`, replacing the old single toggle
  pill) selects Structured vs Scratchpad. Tapping outside the sheet or the ✕ button closes it.
  Successfully parsing a scratchpad list auto-closes the sheet and returns focus to the list;
  structured-form submits keep the sheet open (supports rapid multi-item entry) and refocus the
  name field.
- **List section** (`<main>`) now has a larger `font-display text-xl` "Your List" heading (was
  a small uppercase label), and the `<ul>` sits inside an elevated
  `bg-troli-card/60 dark:bg-troli-carddark/40 rounded-3xl` surface with `min-h-[40vh]` so it
  visually reads as the app's main canvas even when the list is short.
- **Category headers** (from Phase 2.6) are now `sticky top-0` within the scrolling `<main>`,
  with a blurred background matching the page, so they stay visible/legible as you scroll
  through a long categorized list instead of disappearing immediately.

## Salutation / Owner Auto-Detection (unchanged from Phase 2.6/2.7)
Gemini recognizes a line that is just a name + `:`/`-` as a section header (excluded from the
item list), tags subsequent items with that `ownerName` until the next header, and
`State.findOrCreatePerson()` maps that name to an existing or newly-created Person client-side.

## Category Grouping (unchanged from Phase 2.6, rendering polished in 2.8)
Gemini classifies each item into: Sayur-sayuran, Buah-buahan, Daging & Ayam, Ikan & Makanan
Laut, Tenusu, Perencah & Sos, Lain-lain. `renderAll()` groups and sorts via `CATEGORY_ORDER`,
now with sticky headers (see Layout Rework above). Falls back to a flat list with no headers
when everything is in one bucket.

## "Add Qty" — The Primary Per-Item Action (unchanged from Phase 2.6)
Item row's right-side slot shows either the resolved quantity or a "+ Add Qty" button (only
when `qty` is genuinely `null`). Tapping it opens the Edit Item modal with the Qty field
auto-focused. Price is a secondary line under the item name, not the primary affordance.

## Cross-Owner Duplicate Merging (unchanged from Phase 2.7)
Merge key is item name only (case/emoji/whitespace-normalized). An unstated qty counts as 1
once there's another mention to merge with. Owner is promoted to `'shared'` when merged
mentions came from different people. Verified against the user's real example list: `CARROT 🥕
1` + `carrot` (under `Abah :`) → one `Carrot` entry, `qty: 2`, `owner: shared`.

## Features Implemented (cumulative)
- [x] Blank initial state, RM formatting, Trolley Rail progress, offline-first PWA shell
- [x] People management, per-item owner + payment mode, sticky wallet widget
- [x] Settlement engine ("Arahan Malas") modal
- [x] Structured add form (offline-capable, optional Qty/Unit) in a bottom-sheet
- [x] Gemini-only Scratchpad (salutation/owner detection, category classification, cross-owner
      merging) — hard-fails with a clear reason if Gemini is unreachable, no fallback
- [x] Swipe gestures (right = check off, left = reveal Edit/Delete)
- [x] Edit Item modal (name/qty/unit/price/owner/payment mode), focusable on qty via Add Qty
- [x] Adjustments modal — discount & rounding
- [x] Gemini connection status dot + manual/silent health check, refreshed on parse failure
- [x] Toast component + persistent inline error banner (scratchpad); `confirm()` kept only for
      Clear All
- [x] Skeleton pulse loader while Gemini parses
- [x] Category-grouped, sticky-header list rendering
- [x] Auto owner-tagging from detected salutations, with auto-created Person records
- [x] Cross-owner duplicate merging with implicit qty=1 and owner promotion to Shared
- [x] List-first layout: compact header, FAB + bottom-sheet for adding items

## Known Gaps / Next Steps
1. **No receipt photo matching yet** — Phase 3, needs Gemini Vision + `/api/match-receipt.js`.
2. **Gemini model string is hardcoded, not aliased.** `gemini-3.5-flash` works today but Google
   ships breaking model retirements every few months. Worth migrating to the `gemini-flash-latest`
   alias (auto-points to current GA flash model) in a future pass so this class of bug can't
   recur silently.
3. Shared-item cost still splits evenly across all people (including "Me") — no custom ratio.
4. Auto-created people (from salutation detection) start with `cashAdvance: 0` — user should be
   nudged to fill in the real advance amount; currently just relies on them tapping the person
   chip area manually.
5. Scratchpad now strictly requires internet — worth double-checking the FAB/sheet UX makes it
   obvious to a user in a low-signal supermarket that Structured mode is the offline-safe path.
6. `appToast` and `updateToast` still share screen position — low-priority stacking issue.
7. FAB vertical offset (`bottom: calc(6.5rem + safe-area)`) is a fixed estimate to clear the
   footer — if footer content wraps to more lines on a very narrow screen, worth re-checking
   for overlap on-device.

## Setup Reminder (unchanged)
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed for this build.

## Next Prompt Should Confirm
- Ready for Phase 3 (Gemini Vision receipt scanning)?
- Or another polish pass (cash-advance nudge for auto-created people, custom shared-split
  ratios, toast stacking fix, FAB position tuning on-device)?
