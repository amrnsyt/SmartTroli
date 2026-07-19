# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. Long-term vision: AI (Gemini) turns chaotic
WhatsApp lists and photographed receipts into a clean shared checklist and a single settlement
instruction ("Arahan Malas"). Handles mixed payment modes: physical cash advances vs personal
digital/QR payments.

## Phase Roadmap
- **Phase 1 (THIS BUILD — complete, no backend needed)**: People/ownership tags, cash-advance
  wallet, payment-mode tracking, local settlement engine, Dynamic Scratchpad with a *local*
  naive text parser (no AI yet), swipe gestures, offline-first PWA shell.
- **Phase 2 (needs a Gemini API key + a Vercel serverless function)**: Replace the local
  scratchpad parser with real Gemini 1.5 Flash text parsing — dedupes quantities, understands
  local dialect item names, returns structured JSON. Requires `/api/parse-list.js` on Vercel
  (Node serverless function, zero local build needed) with `GEMINI_API_KEY` set as a Vercel
  environment variable — **never** expose the key in client-side code.
- **Phase 3 (Gemini Vision)**: Photograph-a-receipt flow — `/api/match-receipt.js` sends the
  image to Gemini Vision, cross-references abbreviated store text against the existing list,
  flags out-of-list items for ownership tagging and brand-substitution prompts.
- **Phase 4 (polish)**: Skeleton/pulse loading states while Gemini responds, out-of-list item
  popup tagging, 100%-buyer-discount and 5-cent-rounding automation tied directly to receipt
  parsing (Phase 1 already has manual global discount/rounding hooks in the settlement math).

**Blocker for Phase 2/3**: need a Gemini API key from the user, and confirmation they're happy
setting a Vercel environment variable (done via the Vercel dashboard, not the phone file system).

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence (three keys — see Data Model)
- Service Worker — stale-while-revalidate, manual skipWaiting update flow
- vercel.json — zero-cache headers so deploys go live instantly

## File Structure
```
/index.html         -> App shell: header (branding, mode toggle, Clear, progress rail,
                        people chips, wallet actions, structured form OR scratchpad),
                        scrollable list, sticky footer (totals + wallet widget),
                        Person modal, Settlement modal, update-toast
/app.js              -> State (items + people + adjustments), settlement engine,
                        scratchpad parser, swipe-gesture handlers, render pipeline
/manifest.json       -> unchanged from previous milestone
/sw.js               -> CACHE_NAME bumped v3 -> v4 (index.html/app.js changed)
/vercel.json         -> unchanged
/icons/*.png         -> unchanged
/CLAUDE_STATE.md     -> this file
```

## Data Model (Phase 1)
```
Item   = { id, name, price, inTrolley, owner: personId|'shared', paymentMode: 'cash'|'digital' }
Person = { id, name, isMe: boolean, cashAdvance: number }   // 'me' person always exists, isMe=true
Adjustments = { discount: number, rounding: number }         // applied to the Shared bucket
```
- Storage keys: `smarttroli_items_v2`, `smarttroli_people_v2`, `smarttroli_adjustments_v2`
  (bumped from `_v1` since the shape changed — old single-currency data will not carry over).
- Every mutation (add/toggle/remove/update item, add/remove person) saves immediately.

## Settlement Engine Logic ("Arahan Malas")
For each non-"Me" person:
1. `cashPortion` = their owned items paid in cash + their equal share of Shared-bucket cash items.
2. `digitalPortion` = their owned items paid digitally + their equal share of Shared-bucket digital items.
3. `cashRemaining` = their `cashAdvance` − `cashPortion`.
4. Offset: `min(cashRemaining, digitalPortion)` is netted first ("keep RM X cash to offset the
   QR payment you advanced"), then whatever's left over becomes either "return RM X cash to
   {person}" / "collect RM X more cash from {person}" and/or "collect RM X via bank/QR from
   {person}".
This mirrors the target UX exactly: a single plain-English instruction, not a ledger.

## Features Implemented (Phase 1)
- [x] People management: add family member + their cash advance, remove (reassigns their items to "Me")
- [x] Per-item owner tag (any person or "Shared/Kongsi") and payment mode (Cash / Digital-QR)
- [x] Sticky wallet widget: live "Cash in hand" and "Digital advanced" figures
- [x] Settlement modal — one-tap "Arahan Malas" computation per person
- [x] Dual input modes: Structured form (default) and Dynamic Scratchpad (textarea, local
      line-parser: `name ... price` per line, dedupes identical names by summing price)
- [x] Swipe gestures: swipe right on an item = check off (same as tapping the checkbox);
      swipe left reveals Edit/Delete actions
- [x] Inline edit (name + price) via the swiped Edit action
- [x] Blank initial state, RM formatting, Trolley Rail progress, Clear All — retained from prior milestone
- [x] Offline-first PWA shell, manual SW update flow — retained from prior milestone

## Known Gaps / Next Steps
1. **No AI yet.** Scratchpad parsing is a simple regex (expects price at end of each line) —
   won't handle true dialect chaos or merged quantities the way Gemini would. This is Phase 2.
2. **No receipt photo matching** — Phase 3, needs Gemini Vision + serverless function.
3. Global `Adjustments.discount` / `Adjustments.rounding` fields exist in state and are already
   wired into `cashInHand()`, but there is no UI to edit them yet — add a small settings row next.
4. Shared-item cost is split evenly across *all* people including "Me" — no per-person custom
   split ratio yet.
5. Icons unchanged from last milestone; still fine.
6. Edit uses native `prompt()` dialogs for now (fast to ship) — swap for inline modal in a later pass if it feels clunky on-device.

## Deployment Notes (unchanged)
- Root-level static files + `/icons/`, deploy as-is on Vercel, zero build step.
- Remember: bump `CACHE_NAME` in `sw.js` on every deploy that changes cached files (now `v4`).
- Phase 2/3 will add a `/api/` folder — still zero local build; Vercel builds serverless
  functions automatically from `/api/*.js` on push, no `npm run dev` needed on-device.

## Next Prompt Should Confirm
- Do you have a **Gemini API key** ready? If yes, next step is standing up `/api/parse-list.js`
  as a Vercel serverless function (key stored as a Vercel env var) so the Scratchpad mode uses
  real Gemini parsing instead of the local regex fallback.
- Otherwise: continue polishing Phase 1 (discount/rounding UI, custom shared-split ratios,
  nicer edit modal instead of `prompt()`).
