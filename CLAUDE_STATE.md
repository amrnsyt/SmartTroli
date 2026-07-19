# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists and
(eventually) photographed receipts into a clean shared checklist and a single settlement
instruction ("Arahan Malas"). Handles mixed payment modes: physical cash advances vs personal
digital/QR payments. Lists start as QUANTITY-first (prices usually unknown pre-shopping);
prices get filled in at the shelf/checkout.

## Phase Roadmap
- **Phase 1 (complete)**: People/ownership tags, cash-advance wallet, payment-mode tracking,
  local settlement engine, swipe gestures, offline-first PWA shell.
- **Phase 2 (complete)**: Dynamic Scratchpad calls Gemini 1.5 Flash via a Vercel serverless
  function (`/api/parse-list.js`), with automatic offline fallback to a local regex parser.
- **Phase 2.5 (THIS BUILD — polish pass, complete)**:
  - Qty-first data model and parsing (see below) — this was the main ask this round.
  - Gemini connection health check (`/api/health.js` + UI status dot + manual "tap to check").
  - Replaced native `prompt()`/`alert()` calls with proper in-app Edit Item modal and a
    generic toast component. `confirm()` is intentionally kept for the single destructive
    "Clear All" action as a lightweight native guard-rail.
  - Adjustments modal (discount / rounding) now has real UI, wired to the settlement math
    that already existed in Phase 1.
- **Phase 3 (next — Gemini Vision)**: Photograph-a-receipt flow — `/api/match-receipt.js`
  sends the image to Gemini Vision, cross-references abbreviated store text against the
  existing list, flags out-of-list items for ownership tagging and brand-substitution prompts.
- **Phase 4 (polish)**: out-of-list item popup tagging, tie discount/rounding automation
  directly to receipt parsing instead of manual entry.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow
- vercel.json — zero-cache headers
- Vercel Node Serverless Functions in `/api/` (zero local build, auto-detected on push)

## File Structure
```
/index.html           -> App shell: header (branding, mode toggle, Clear, progress rail,
                          people chips, +Person/Adjust/Settle actions, structured form OR
                          scratchpad w/ skeleton loader + Gemini connection dot), scrollable
                          list, sticky footer (totals + wallet), Person/Edit/Adjust/Settlement
                          modals, generic Toast, update-toast
/app.js                -> State (items + people + adjustments), settlement engine, qty-first
                          Gemini call + local fallback parser, Edit Item modal logic,
                          Adjustments modal logic, Gemini connection check, toast(), swipe
                          gestures, render pipeline
/api/parse-list.js     -> Vercel serverless fn. Qty-first Gemini prompt: extracts
                          {name, qty, unit, price}, price defaults to 0 unless explicitly
                          stated in the text (no more guessing/estimating a price).
/api/health.js         -> NEW. Vercel serverless fn (GET). Confirms GEMINI_API_KEY is set and
                          does a minimal live Gemini call to confirm real connectivity.
                          Returns {ok, message}. Used by the UI's connection-status dot.
/manifest.json         -> unchanged
/sw.js                 -> CACHE_NAME bumped v5 -> v6 (index.html/app.js changed).
                          Fetch handler still ignores non-GET requests, so POSTs to
                          /api/parse-list and GETs to /api/health both bypass SW caching logic
                          appropriately (health check always hits network fresh).
/vercel.json           -> unchanged
/icons/*.png           -> unchanged
/CLAUDE_STATE.md       -> this file
```

## Data Model (Phase 2.5 — QTY-FIRST)
```
Item   = { id, name, qty, unit, price, inTrolley, owner: personId|'shared', paymentMode: 'cash'|'digital' }
Person = { id, name, isMe: boolean, cashAdvance: number }
Adjustments = { discount: number, rounding: number }
```
- **Storage keys**: `smarttroli_items_v3` (bumped from `_v2` — qty/unit added to schema, old
  data will not carry over), `smarttroli_people_v2` (unchanged), `smarttroli_adjustments_v2`
  (unchanged).
- `qty` defaults to 1, `unit` defaults to `''`, `price` defaults to 0 — an item with price 0
  renders its price as an orange "Add price" hint instead of "RM 0.00", making it obvious
  which items still need pricing at the shelf.
- Settlement math (`estimatedTotal`, `trolleyTotal`, `cashInHand`, `digitalSpent`, `settlement()`)
  is unchanged — it still sums `item.price`, so unpriced items simply contribute RM0 until
  the user (or Gemini via a future receipt scan) fills the price in.

## Qty-First Parsing Logic
**Gemini prompt (`/api/parse-list.js`)**: explicitly instructed this is a PRE-SHOPPING list —
extract `{name, qty, unit, price}`, only set `price` if an explicit number/RM value appears in
that line; otherwise `price: 0`. Duplicate items (fuzzy name match) are merged, qty summed,
price only summed if both had explicit prices.

**Local fallback parser (`app.js` — `parseScratchLine` / `localParseFallback`)**, used when
Gemini is unreachable, checks in this priority order per line:
1. Explicit `RM<number>` at the end → price-based item, qty = 1.
2. Trailing `<number> <unit>` (ekor, batang, biji, kg, g, ml, l, pcs, bungkus, kotak, tin,
   botol, etc.) → qty-based item, price = 0.
3. Bare trailing integer with no decimal/unit → treated as **quantity**, not price
   (this is the key behavior change — previously a bare number was assumed to be a price).
4. No numeric signal at all → qty = 1, price = 0.

## Gemini Connection Check
- `/api/health.js`: server-side GET, confirms `GEMINI_API_KEY` exists and makes a minimal
  live `generateContent` call (`maxOutputTokens: 5`) to prove real connectivity, not just
  "the env var is set."
- UI: a small status dot next to "✨ Gemini" in the scratchpad section — gray while checking,
  green when confirmed OK, orange if it fails (missing key, rejected key, or unreachable).
- Runs once silently on every app load (`checkGeminiConnection(true)`), and again manually
  (with a toast result) whenever the user taps it.

## Native-Dialog Cleanup (Polish)
- ❌ Removed: `prompt()`-chain for editing items → ✅ replaced with the Edit Item modal
  (name, qty, unit, price, owner, payment mode all editable in one screen).
- ❌ Removed: `alert()` for scratchpad parse results/errors → ✅ replaced with `toast()`,
  a small auto-dismissing banner (info/success/error tones).
- ✅ Kept: `confirm()` for "Clear All" only — a single native yes/no guard on a destructive,
  irreversible action is still the simplest reliable pattern; not worth a custom modal yet.

## Features Implemented (cumulative)
- [x] Blank initial state, RM formatting, Trolley Rail progress, offline-first PWA shell
- [x] People management, per-item owner + payment mode, sticky wallet widget
- [x] Settlement engine ("Arahan Malas") modal
- [x] Dual input modes: Structured form (now with optional Qty/Unit fields) + Dynamic
      Scratchpad (Gemini-powered, qty-first, offline fallback)
- [x] Swipe gestures (right = check off, left = reveal Edit/Delete)
- [x] Edit Item modal (replaces prompt chain) — edits name/qty/unit/price/owner/payment mode
- [x] Adjustments modal — discount & rounding, feeds into `cashInHand()` settlement math
- [x] Gemini connection status dot + manual check + silent on-load check
- [x] Generic toast component replacing native `alert()`
- [x] Skeleton pulse loader while Gemini parses

## Known Gaps / Next Steps
1. **No receipt photo matching yet** — Phase 3, needs Gemini Vision + `/api/match-receipt.js`
   + a camera/file-input UI.
2. Shared-item cost still splits evenly across all people (including "Me") — no custom ratio.
3. `appToast` and `updateToast` share the same screen position (`bottom-24 left-4 right-4`) —
   if both fire at once the second will visually stack on the first; low-priority polish item.
4. Structured form's new Qty/Unit fields are optional and unlabeled beyond placeholder text —
   consider small `<label>`s if user testing shows confusion.

## Setup Reminder (unchanged from Phase 2)
`GEMINI_API_KEY` must be set in Vercel → Settings → Environment Variables. This build adds
`/api/health.js`, which uses the same env var — no additional setup needed if Phase 2 was
already configured.

## Next Prompt Should Confirm
- Ready to build Phase 3 (receipt photo scanning via Gemini Vision)?
- Or further polish (labels on qty/unit fields, custom shared-split ratios, toast stacking fix)?
