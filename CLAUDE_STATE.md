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
- **Phase 2.12 (THIS BUILD — bugfix, complete)**: Made the "New version available" update
toast fire reliably instead of depending on the tab staying open 60+ seconds. Previously
`index.html` only called `reg.update()` on a 60s `setInterval` — on mobile, PWAs get
backgrounded/suspended, the timer stalls, and the popup could silently never appear until a
manual full reload. Now `reg.update()` also fires immediately on registration, on
`visibilitychange` (tab/app foregrounded again), and on `pageshow` (bfcache restores). No
change to the underlying skipWaiting/waiting-worker flow — user still taps "Update Now" to
apply it. `sw.js` `CACHE_NAME` bumped v11 -> v12 to ship this as a detectable new version.
- **Phase 2.13 (THIS BUILD — complete)**: Gemini's extracted **qty (and unit) is now editable
  before it's added to the list.** Previously `parseWithGemini()`'s results were committed to
  `State` immediately on a successful parse. Now a successful parse renders a review step
  (`#scratchPreviewWrap`) inside the scratchpad panel: one row per detected item (name, owner/
  category context) with an editable Qty and Unit input, pre-filled with Gemini's values. The
  user can correct a wrong/missing qty right there, tap "Back" to return to the raw text (e.g.
  to re-word and re-parse), or tap "Add to List" to commit — which reads the live input values
  (not Gemini's originals) before calling `State.addItem()`/`State.findOrCreatePerson()`. No
  change to the underlying parse call, dedupe/merge behavior, or owner-tagging — this only adds
  a correction step between "Gemini responded" and "items hit the list."
- **Phase 3 (THIS BUILD — first pass complete — Gemini Vision)**: Photograph-a-receipt flow.
  New `/api/match-receipt.js` (Vercel fn, same timeout-budget convention as `parse-list.js`:
  22s in-file abort, 30s `vercel.json` maxDuration, `thinkingLevel: "low"`) takes a base64 photo
  + the user's current item list (id+name only) and sends both to `gemini-3.5-flash` as a
  multimodal request. Gemini reads each printed line item + price off the receipt and either
  matches it to an existing list item by (fuzzy) name — returned as `{itemId, price}` — or, if
  nothing matches, returns it as an `extra` — `{name, price}` — for the user's awareness only.
  New "📸 Scan Receipt" header button opens a camera-capable file input
  (`capture="environment"`); on photo select, `app.js` reads it to a data URL, POSTs to the new
  endpoint, applies every match via `State.updateItem(id, { price })`, and shows a
  `#receiptModal` summarizing what got auto-priced and what was on the receipt but not in the
  list. **Adding those "extra" receipt lines into the list is intentionally NOT done in this
  pass** — that's the popup-tagging flow already scoped for Phase 4 below, so it isn't
  duplicated here.
- **Phase 3.1 (THIS BUILD — complete)**:
  1. **Receipt upload alongside camera capture.** The single "📸 Scan Receipt" button used a
     file input with `capture="environment"`, which forces mobile browsers straight into the
     live camera and skips the gallery/file picker entirely — there was no way to select an
     existing photo. Split into two explicit entry points: "📸 Take Photo" (unchanged, still
     `capture="environment"`) and "🖼️ Upload Photo" (new `#receiptUploadInput`, no `capture`
     attribute, opens the normal file/gallery picker). Both share one `handleReceiptFile()`
     function (refactored out of the old single change-handler) so there's no duplicated
     scanning/matching logic. Header action row is now `overflow-x-auto` since it holds 5
     buttons.
  2. **Dark theme redesign — was flat, muddy, low-contrast ("gloomy").** Old dark palette was
     near-black-olive-on-near-black (`bgdark #14170F`, `carddark #1E2317`, accent
     `greenlight #4C7A3F`) with almost no color variation anywhere — category headers, buttons,
     and text all leaned on the same muted forest green. Redesigned:
     - New tokens: `bgdark #0E1512` (deeper, cooler), `carddark #182420` (more lift off bg),
       `greenlight #34D399` (vivid emerald, was muddy `#4C7A3F`), `orange #E8641F` +
       new `orangelight #FB923C`, new `amber #F5B942`, new `sky #5EB4E8`.
     - Gradients added for visual depth: header logo badge, Trolley Rail progress fill,
       floating "+" button, Trolley Total footer pill, and all primary buttons (new
       `.troli-btn-primary` CSS utility, gradient `#2F5233 → #34D399`, replacing flat
       `bg-troli-green dark:bg-troli-greenlight text-white` everywhere it appeared — that flat
       combo had borderline white-on-bright-emerald contrast once the accent got brighter).
     - **Category headers are now color-coded**, not uniform green: fixed color-per-category
       map (`CATEGORY_COLORS` in `app.js`) — emerald/amber/orange/sky/violet/tangerine/neutral
       — rendered as a colored dot + tinted label. Colors are assigned by category name (not
       render order), so a category keeps the same color across every render.
     - Dark-mode checkbox accent updated to match (`#34D399`, was `#7FA96B`).
- **Phase 2.14 (THIS BUILD — bugfix, complete)**: Fixed `"Gemini API error: Gemini returned
  unparseable JSON"` on scratchpad parsing (screenshot showed it firing on a normal list —
  not an edge case). Root cause: Phase 2.11 added `thinkingConfig: { thinkingLevel: "low" }`
  to get 504s under control, but that's exactly what reintroduced this — Gemini 3.x models can
  leak reasoning/thought text ahead of the real answer even when no part is flagged
  `thought: true` and even with `responseMimeType: "application/json"` (documented upstream
  quirk, see `googleapis/python-genai#2121`). `gemini-1.5-flash` never had a thinking pass, so
  this never happened before Phase 2.11 — the symptom is new, but the underlying cause is the
  same thinking-latency tradeoff that Phase 2.11 accepted, not a regression in this build.
  Fix: new `api/_lib.js` (underscore-prefixed so Vercel doesn't turn it into a route, but it's
  still `require()`-able from sibling functions) exports `safeJsonParse()` — tries a plain
  `JSON.parse()` first, then strips markdown fences, then falls back to locating the real
  JSON value (first `[`/`{` to its matching last `]`/`}`) inside whatever text Gemini actually
  returned, instead of assuming the whole string is clean JSON. Wired into both
  `api/parse-list.js` and `api/match-receipt.js` (same failure mode applies to both, since both
  set `thinkingConfig`). `api/health.js` untouched — it never parses Gemini's answer as JSON.
  No change to `thinkingLevel: "low"` itself — reverting that would bring back the Phase 2.11
  504s, so this is a parse-robustness fix layered on top rather than a tradeoff reversal.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow
- vercel.json — zero-cache headers
- Vercel Node Serverless Functions in `/api/`

## File Structure
```
/index.html           -> App shell — COMPACT header (branding w/ gradient logo badge, Clear,
                          gradient progress rail, people chips, +Person/Adjust/Take Photo/
                          Upload Photo/Settle actions — now overflow-x-auto, 5 buttons), list
                          as primary content (elevated card w/ dark-mode border for definition,
                          color-coded sticky category headers, larger title), gradient floating
                          "+" add button, gradient Trolley Total pill, #addSheet bottom-sheet
                          modal (mode switch buttons + structured form + Gemini-only scratchpad
                          w/ skeleton loader, connection dot, persistent error banner, and —
                          Phase 2.13 — an editable qty/unit review step (#scratchPreviewWrap)
                          shown after a successful parse, before anything is committed),
                          Person/Edit/Adjust/Settlement modals (all using new .troli-btn-primary
                          gradient utility), generic Toast, update-toast. Phase 2.12: SW update
                          check (reg.update()) now also fires on visibilitychange + pageshow +
                          immediately on register, not just a 60s interval. Phase 3: hidden
                          camera-capable #receiptFileInput + #receiptScanningOverlay spinner +
                          #receiptModal summarizing auto-priced items and unmatched extras.
                          Phase 3.1: NEW #receiptUploadInput (no `capture` attr — opens gallery/
                          file picker) alongside the camera input; redesigned dark palette
                          (richer bg/card tones, vivid emerald/amber/orange accents, gradients
                          throughout) — see "Dark Theme Redesign" section below.
/app.js                -> State (items+people+adjustments), normalizeQty(), category grouping
                          in renderAll() w/ sticky COLOR-CODED headers (Phase 3.1:
                          CATEGORY_COLORS map + categoryColor()), findOrCreatePerson(),
                          settlement engine, Edit modal, Adjustments modal, Gemini connection
                          check, toast(), swipe gestures, openAddSheet()/closeAddSheet()/
                          setAddMode() for the bottom sheet, and a Gemini-only parseWithGemini()
                          with reason-specific error handling (offline/timeout/api/network) — NO
                          local fallback parser. Phase 2.13: renderScratchPreview()/
                          resetScratchPreview() + scratchConfirmBtn/scratchBackBtn handlers —
                          parse result now lands in an editable review list (pendingParsed)
                          instead of being committed to State immediately. Phase 3:
                          fileToBase64(), showReceiptResult() rendering the result modal.
                          Phase 3.1: scan logic refactored into shared handleReceiptFile(),
                          called by BOTH scanReceiptBtn (camera) and new uploadReceiptBtn
                          (gallery/file picker) — no duplicated matching logic between the two
                          entry points.
/api/parse-list.js     -> Vercel serverless fn. Prompt unchanged. Model: gemini-3.5-flash.
                          Phase 2.11: generationConfig now sets thinkingConfig.thinkingLevel
                          = "low" (fixed the 504s). Phase 2.14: JSON.parse(raw) replaced with
                          _lib.js's safeJsonParse(raw) — thinkingLevel can still leak thought
                          text ahead of the real JSON; this strips it instead of trusting raw.
/api/health.js         -> Gemini connection check. Same thinkingLevel: "low" fix as
                          parse-list.js. maxOutputTokens raised 5 -> 32 (thinking tokens eat
                          into this budget even at low level). Doesn't parse Gemini's answer as
                          JSON, so Phase 2.14's safeJsonParse fix doesn't apply here.
/api/match-receipt.js  -> NEW (Phase 3). Vercel serverless fn, Gemini Vision. Takes a base64
                          receipt photo + the user's {id,name} item list, returns {matches:
                          [{itemId,price}], extras:[{name,price}]}. Same timeout-budget
                          convention and thinkingLevel: "low" as parse-list.js. Phase 2.14:
                          also uses _lib.js's safeJsonParse(raw) for the same leak reason.
/api/_lib.js           -> NEW (Phase 2.14). Underscore-prefixed so Vercel does NOT expose it as
                          a route, but parse-list.js/match-receipt.js require() it fine.
                          Exports safeJsonParse(raw): plain JSON.parse -> strip markdown fence
                          -> locate first [ or { to its matching last ] or } and parse that
                          slice. Add any future Gemini-calling endpoint's parsing here too.
/manifest.json         -> unchanged
/sw.js                 -> CACHE_NAME bumped ... -> v13 -> v14 (latest: Phase 3.1 index.html +
                          app.js changes). Fetch handler excludes /api/* paths from caching
                          entirely (always network-live, fixes stale health-check results).
/vercel.json           -> "functions" block: maxDuration 30s for api/parse-list.js, 15s for
                          api/health.js, 30s for the new api/match-receipt.js (Phase 3).
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

## Dark Theme Redesign (Phase 3.1)
Complaint was the dark mode looked "gloomy" — accurate diagnosis: the old dark tokens
(`bgdark #14170F`, `carddark #1E2317`, `greenlight #4C7A3F`) were all low-saturation
near-black/near-olive with barely any hue separation from each other, so cards, header, and
background all blurred together with no visual energy.
- **New tokens**: `bgdark #0E1512`, `carddark #182420` (more lift off bg), `greenlight #34D399`
  (vivid emerald), `orange #E8641F` + new `orangelight #FB923C`, new `amber #F5B942`, new
  `sky #5EB4E8`. Light-mode `bg` also warmed slightly (`#F6F4EE` → `#FBF7EE`).
- **Gradients** (all inline `style`, not Tailwind classes, since Tailwind CDN has no arbitrary
  gradient utility support here): header logo badge, Trolley Rail fill, floating "+" FAB,
  Trolley Total footer pill, and every primary button via the new `.troli-btn-primary` CSS
  class (`linear-gradient(135deg, #2F5233, #34D399)`, white text) — this replaced the old flat
  `bg-troli-green dark:bg-troli-greenlight text-white` pattern everywhere it appeared (Person/
  Edit/Adjust Save buttons, "Add to List", Structured mode-toggle active state). The flat
  version had gotten borderline-low-contrast once `greenlight` became a brighter, lighter
  emerald — a solid emerald fill with white text reads worse than the gradient, which anchors
  on the darker green.
- **Category headers are color-coded**: `CATEGORY_COLORS` in `app.js` maps each of the 7
  categories to a fixed hex (not cycled by render order, so a category keeps its color across
  re-renders): Sayur-sayuran emerald, Buah-buahan amber, Daging & Ayam orange, Ikan & Makanan
  Laut sky, Tenusu violet (`#C084FC`), Perencah & Sos tangerine, Lain-lain neutral gray. Each
  header renders a colored dot + tinted label instead of uniform green text.
- **List card container** got a subtle dark-mode border (`dark:border-troli-raildark/60`) and
  higher opacity (`dark:bg-troli-carddark/80`, was `/40`) — the old version was nearly
  invisible against the background, contributing to the "flat" feeling.
- Dark-mode checkbox accent updated to match (`#34D399`).

## Receipt Photo: Camera + Upload (Phase 3.1)
Previously the single "📸 Scan Receipt" button used `<input type="file" capture="environment">`
— the `capture` attribute forces mobile browsers to jump straight into the live camera, with no
option to pick an existing photo from the gallery. Split into two buttons:
- **"📸 Take Photo"** (`#scanReceiptBtn` / `#receiptFileInput`, unchanged) — still forces the
  live camera via `capture="environment"`.
- **"🖼️ Upload Photo"** (`#uploadReceiptBtn` / `#receiptUploadInput`, new) — plain
  `<input type="file" accept="image/*">` with NO `capture` attribute, which opens the normal
  OS file/gallery picker.
Both call the same refactored `handleReceiptFile(file)` in `app.js` (previously inline in the
single change-handler) — no duplicated scan/match/render logic between the two entry points.
Header action row is now `overflow-x-auto` since it holds 5 buttons (+Person, Adjust, Take
Photo, Upload Photo, Settle) — too many to comfortably fit one fixed-width row on narrow phones.

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
- [x] Scratchpad review step — Gemini's extracted qty/unit editable before commit to the list
- [x] Gemini Vision receipt scan — photo → matched prices auto-filled, unmatched extras shown
- [x] Receipt scanning: separate Take Photo (camera) and Upload Photo (gallery/file) entry points
- [x] Redesigned dark theme — vivid gradient accents, color-coded categories, no more flat/gloomy

## Known Gaps / Next Steps
1. **safeJsonParse (Phase 2.14) is a mitigation, not a guarantee.** It handles leaked
   thought-text and markdown fences around a JSON value, but if Gemini ever returns something
   with NO recognizable `[`/`{` at all (e.g. a plain apology sentence with zero JSON), the
   endpoint still correctly fails with "unparseable JSON" rather than silently returning
   garbage — that's intended, just worth knowing this isn't a 100%-uptime guarantee against
   Gemini being uncooperative, only against the specific leak pattern that was happening.
2. **Receipt "extras" are read-only (Phase 4 territory).** `/api/match-receipt.js` returns
   unmatched receipt lines, and `#receiptModal` displays them, but there's no tap-to-add
   action yet — the user still has to add those manually via the structured form.
3. **Gemini model string is hardcoded, not aliased.** `gemini-3.5-flash` works today but Google
   ships breaking model retirements every few months. Worth migrating to the `gemini-flash-latest`
   alias (auto-points to current GA flash model) in a future pass so this class of bug can't
   recur silently.
4. Shared-item cost still splits evenly across all people (including "Me") — no custom ratio.
5. Auto-created people (from salutation detection) start with `cashAdvance: 0` — user should be
   nudged to fill in the real advance amount; currently just relies on them tapping the person
   chip area manually.
6. Scratchpad and receipt scanning both strictly require internet — worth double-checking the
   UX makes it obvious to a user in a low-signal supermarket that Structured mode (manual add)
   is the only offline-safe path.
7. `appToast` and `updateToast` still share screen position — low-priority stacking issue.
8. FAB vertical offset (`bottom: calc(6.5rem + safe-area)`) is a fixed estimate to clear the
   footer — if footer content wraps to more lines on a very narrow screen, worth re-checking
   for overlap on-device.
9. Receipt matching sends the FULL item list (id+name) to Gemini every scan, regardless of
   `inTrolley` status — fine at current list sizes, but worth revisiting (e.g. only send items
   still missing a price) if lists grow large enough to affect prompt size/latency.
10. No de-dupe guard if the same receipt is scanned twice — a second scan will just re-match and
   overwrite prices again (harmless, just redundant) rather than warning "already scanned."

## Setup Reminder (unchanged)
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed for this build — `/api/match-receipt.js` reuses the same key.

## Next Prompt Should Confirm
- Redesigned dark theme and receipt upload option are new — worth a quick on-device look before
  going further, in case any gradient/contrast combo needs tuning for real screens.
- Ready for Phase 4 (tap-to-add popup for receipt "extras", custom shared-split ratios,
  cash-advance nudge for auto-created people, toast stacking fix, FAB position tuning)?
- Or first want to stress-test Phase 3 receipt scanning on-device (blurry photos, long
  receipts, non-Latin fonts) before moving on?
