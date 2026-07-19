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
/api/parse-list.js     -> Vercel serverless fn. Unchanged prompt: detects salutation/owner
                          sections, classifies items into categories, keeps qty null when
                          genuinely unstated, merges duplicate item names globally with owner
                          promotion to "Shared".
/api/health.js         -> Gemini connection check (unchanged from Phase 2.5).
/manifest.json         -> unchanged
/sw.js                 -> CACHE_NAME bumped v8 -> v9 (index.html/app.js changed)
/vercel.json           -> unchanged
/icons/*.png           -> unchanged
/CLAUDE_STATE.md       -> this file
```

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
2. Shared-item cost still splits evenly across all people (including "Me") — no custom ratio.
3. Auto-created people (from salutation detection) start with `cashAdvance: 0` — user should be
   nudged to fill in the real advance amount; currently just relies on them tapping the person
   chip area manually.
4. Scratchpad now strictly requires internet — worth double-checking the FAB/sheet UX makes it
   obvious to a user in a low-signal supermarket that Structured mode is the offline-safe path.
5. `appToast` and `updateToast` still share screen position — low-priority stacking issue.
6. FAB vertical offset (`bottom: calc(6.5rem + safe-area)`) is a fixed estimate to clear the
   footer — if footer content wraps to more lines on a very narrow screen, worth re-checking
   for overlap on-device.

## Setup Reminder (unchanged)
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. No new env vars
needed for this build.

## Next Prompt Should Confirm
- Ready for Phase 3 (Gemini Vision receipt scanning)?
- Or another polish pass (cash-advance nudge for auto-created people, custom shared-split
  ratios, toast stacking fix, FAB position tuning on-device)?
