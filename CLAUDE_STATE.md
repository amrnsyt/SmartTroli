# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. Long-term vision: AI (Gemini) turns chaotic
WhatsApp lists and photographed receipts into a clean shared checklist and a single settlement
instruction ("Arahan Malas"). Handles mixed payment modes: physical cash advances vs personal
digital/QR payments.

## Phase Roadmap
- **Phase 1 (complete)**: People/ownership tags, cash-advance wallet, payment-mode tracking,
  local settlement engine, swipe gestures, offline-first PWA shell.
- **Phase 2 (THIS BUILD — complete)**: Dynamic Scratchpad now calls real Gemini 1.5 Flash via
  a Vercel serverless function (`/api/parse-list.js`). Dedupes duplicate items, understands
  local dialect names, returns structured JSON. `GEMINI_API_KEY` lives as a Vercel environment
  variable — never sent to or stored in the client. Automatic offline fallback: if the Gemini
  call fails or times out (9s), the app silently falls back to the Phase 1 local regex parser
  so it still works with poor supermarket signal. Skeleton pulse loader shown while parsing.
- **Phase 3 (next — Gemini Vision)**: Photograph-a-receipt flow — `/api/match-receipt.js` sends
  the image to Gemini Vision, cross-references abbreviated store text against the existing list,
  flags out-of-list items for ownership tagging and brand-substitution prompts.
- **Phase 4 (polish)**: out-of-list item popup tagging, 100%-buyer-discount and 5-cent-rounding
  automation tied directly to receipt parsing (Phase 1 already has manual global
  discount/rounding hooks in the settlement math; still needs a settings UI).

**Blocker for Phase 3**: none new — same Gemini API key works for Vision calls, just needs the
new endpoint file and a client-side camera/file-input flow.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence (three keys — see Data Model)
- Service Worker — stale-while-revalidate, manual skipWaiting update flow
- vercel.json — zero-cache headers so deploys go live instantly

## File Structure
```
/index.html          -> App shell: header (branding, mode toggle, Clear, progress rail,
                         people chips, wallet actions, structured form OR scratchpad w/
                         skeleton loader), scrollable list, sticky footer (totals + wallet),
                         Person modal, Settlement modal, update-toast
/app.js               -> State (items + people + adjustments), settlement engine,
                         Gemini API call w/ offline local-parser fallback, swipe gestures,
                         render pipeline
/api/parse-list.js    -> NEW. Vercel Node serverless function. Reads GEMINI_API_KEY from
                         process.env, calls gemini-1.5-flash generateContent with a
                         dedupe/parse prompt, returns {items:[{name,price}]} JSON.
/manifest.json        -> unchanged
/sw.js                -> CACHE_NAME bumped v4 -> v5 (index.html/app.js changed).
                         Note: fetch handler already ignores non-GET requests, so POSTs to
                         /api/parse-list bypass the Service Worker entirely — no SW change needed.
/vercel.json          -> unchanged
/icons/*.png          -> unchanged
/CLAUDE_STATE.md      -> this file
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
1. **Receipt photo matching not built yet** — Phase 3, needs Gemini Vision + a new
   `/api/match-receipt.js` endpoint plus a camera/file-input UI.
2. Gemini errors surface via `alert()` only when falling back to local parsing — consider a
   nicer inline banner instead of native alerts in a later polish pass.
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

## Setup Required Before This Deploy Works
1. In the Vercel dashboard → your SmartTroli project → Settings → Environment Variables:
   add `GEMINI_API_KEY` = `<your key>`, scoped to Production (and Preview/Development if you
   test there too).
2. Redeploy (env var changes require a new deployment to take effect — pushing this commit
   will trigger one anyway).
3. Test: switch to Scratchpad mode, paste a messy list, tap "Parse into list" — you should see
   the skeleton pulse briefly, then structured items appear.
4. Test offline fallback: enable Airplane Mode, repeat step 3 — you should get the "Parsed
   locally (offline mode)" alert instead of a hard failure.

## Next Prompt Should Confirm
- Ready to build Phase 3 (receipt photo scanning via Gemini Vision)?
- Or continue Phase 1/2 polish (discount/rounding settings UI, nicer non-native edit/alert UI,
  custom shared-split ratios)?
