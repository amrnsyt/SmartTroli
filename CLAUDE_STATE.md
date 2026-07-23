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
`gemini-3.1-flash-lite`, local OCR fallback (Tesseract.js) for Gemini outages.
- **Phase 10 (complete)**: Undo action for mis-scanned Bought items, cash-advance nudge queue
for auto-created family members, manual "Skip Gemini (use local OCR)" toggle, custom
shared-split ratios (`shareWeight` per person).
- **Phase 11 (complete)**: Scratchpad preview unit input disabled (qty-only editing);
split-purchase receipt matching fix (a merged-qty list item like "Ayam" qty 2 can now match
TWO separate receipt lines instead of capping at one); manual "Mark as Bought" flow for
purchases with no receipt at all.
- **Phase 12 (THIS BUILD — complete)**: **Multi-stop shopping — track spend per store/trip.**
  - **Trigger**: A single shopping session commonly spans several physical stops (wet market
    for fresh produce, supermarket for packaged goods, pharmacy for household items). Previously
    every Bought item landed in one undifferentiated pool with no way to see "how much did I
    spend at the wet market vs the supermarket" — everything was implicitly treated as a single
    stop.
  - **Data model** — new concept: **Trip** = `{ id, name, createdAt }`, stored under a new
    localStorage key `smarttroli_trips_v1`. The currently-active trip id is tracked separately
    in `smarttroli_currenttrip_v1`. `Item` gains a `tripId: string|null` field — assigned ONLY
    at the moment an item is confirmed **Bought** (via receipt scan match OR the Phase 11
    manual "Mark as Bought" flow), tagged with whichever trip is active at that instant. Items
    are deliberately NOT tagged at add-time, since you don't know which stop will actually have
    an item in stock until you're there.
    - Backward compatible: a fresh install (or an existing install upgrading from a pre-Phase-12
      build) auto-creates one default trip ("Trip 1") on first load — zero setup required, and
      all pre-existing Bought items simply show as "Unassigned" when grouped by trip.
  - **`State` additions** (`app.js`): `trips[]`, `currentTripId`, `startTrip(name)` (creates +
    switches to a new trip), `switchTrip(id)`, `currentTrip()`, `tripTotal(tripId)` (sum of
    `price` for items tagged to that trip), `tripItemCount(tripId)` (count of scanned items
    tagged to that trip). `saveTrips()` / `saveCurrentTrip()` persist to the two new keys.
  - **Tagging points** — every place an item transitions to Bought now also sets
    `tripId: State.currentTripId`:
    - `handleReceiptFile()`'s match-handling (both the first-match-updates-original-record path
      AND Phase 11's clone-for-additional-matches path).
    - `showReceiptResult()`'s manual extra-assignment dropdown (both "assign to existing" and
      "add as new" branches).
    - Phase 11's manual "Mark as Bought" (`markBoughtSaveBtn` handler).
    - The Phase 10 step 1 "↩ Undo" action now also CLEARS `tripId: null` when reverting an item
      back to To Buy, since the item is no longer a confirmed purchase at any stop.
  - **UI additions** (`index.html` + `app.js`):
    - New **Trip bar** (`#currentTripBtn`) under the app title, above the People chips: shows
      the active trip's name + running total (`State.tripTotal`), tappable to open the Trip
      modal.
    - New **Trip Modal** (`#tripModal`): lists every trip (newest first) with item count +
      spend, an "Active" badge on the current one, tap-to-switch on any row, plus a text input
      + "Start" button to create and immediately switch to a brand-new stop.
    - New **Category/Trip grouping toggle** (`#boughtGroupToggleWrap`, only visible in the
      Bought tab): "By Category" (original behavior, unchanged) vs "By Trip 🏬" — when in Trip
      mode, `renderAll()`'s grouping key switches from `item.category` to `item.tripId`, trip
      group headers show a spend subtotal, and trips are ordered chronologically
      (oldest-first); items with no `tripId` (pre-Phase-12 records, or edge cases) group under
      "Unassigned" rather than being hidden.
  - **No server-side changes this phase** — trips are a purely client-side/localStorage
    concept; `api/*.js` files are untouched.
  - `sw.js` `CACHE_NAME` bumped `v25` -> `v26` since `app.js` and `index.html` both changed.

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
`runLocalOcrFallback()` function.

## File Structure
```
/index.html            -> UPDATED this build. Phase 12: new #currentTripBtn trip bar (under
                           header, above people chips), new #boughtGroupToggleWrap
                           (Category/Trip toggle, Bought tab only), new #tripModal (trip list +
                           start-new-trip form). Phase 11's disabled preview-unit input and
                           #markBoughtModal unchanged this build.
/app.js                 -> UPDATED this build. Phase 12: State.trips/currentTripId +
                           startTrip()/switchTrip()/currentTrip()/tripTotal()/tripItemCount(),
                           TRIPS_KEY/CURRENT_TRIP_KEY localStorage persistence, addItem() now
                           sets tripId:null by default, every Bought-transition point (receipt
                           match first-hit + clones, extras assign/add-new, Mark-as-Bought) now
                           tags tripId:State.currentTripId, Undo clears tripId back to null,
                           renderCurrentTripBar()/renderTripList() + trip modal wiring,
                           boughtGroupMode ('category'|'trip') drives renderAll()'s grouping key
                           and header rendering in the Bought tab.
                           (All Phase 1-11 features — settlement engine, tabs, Undo, cash-
                           advance nudge, Skip Gemini toggle, Share ratio, Mark-as-Bought,
                           split-receipt-match — unchanged.)
/api/_gemini.js         -> unchanged this build.
/api/_lib.js             -> unchanged this build.
/api/parse-list.js      -> unchanged this build.
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> unchanged this build (Phase 12 is entirely client-side).
/manifest.json           -> unchanged.
/sw.js                   -> UPDATED this build. CACHE_NAME v25 -> v26 (app.js + index.html
                           both changed).
/vercel.json             -> unchanged this build.
/icons/*.png             -> unchanged.
/CLAUDE_STATE.md         -> this file.
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. `match-receipt.js` makes TWO Gemini calls per scan;
a local OCR fallback exists below that (auto-triggered on failure, or manually via the "Skip
Gemini" toggle). Manual Mark-as-Bought (Phase 11) and Trip switching (Phase 12) are both
Gemini-free, purely local paths.
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
                           └─ IF THIS FAILS (or "Skip Gemini" is ON): local Tesseract.js OCR
                              fallback runs client-side, no server timeout budget involved.
                           └─ Mark-as-Bought (Phase 11) and Trip switching (Phase 12) bypass
                              this ENTIRE chain — no Gemini call, instant local state update.
```

## Data Model
```
Item   = { id, name, qty: number|null, unit, price, category, inTrolley,
           owner: personId|'shared', paymentMode: 'cash'|'digital', scanned: boolean,
           tripId: string|null }   // tripId added Phase 12 — set only once item is Bought
Person = { id, name, isMe: boolean, cashAdvance: number, shareWeight: number }
Trip   = { id, name, createdAt: number }   // NEW Phase 12
Adjustments = { discount: number, rounding: number }
```
Storage keys: `smarttroli_items_v4`, `smarttroli_people_v2`, `smarttroli_adjustments_v2`
(all unchanged), plus NEW this build: `smarttroli_trips_v1` (Trip[] array) and
`smarttroli_currenttrip_v1` (a plain string — the active trip's id).

## match-receipt.js Request/Response Shape (unchanged this build — see Phase 11 notes)
Request `items` array includes `qty` per item: `[{ id, name, qty }]`. Response:
```
{
  matches: [{ itemId: string, price: number, receiptName: string }],
  extras:  [{ name: string, price: number }]
}
```
`matches` MAY contain more than one entry with the SAME `itemId` (Phase 11) — client groups by
`itemId` before applying, and (Phase 12) tags every resulting Bought record with the currently
active trip.

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Last
bumped: `v26` (this build — app.js + index.html changed).

## Known Gaps / Next Steps
1–10. All Phase 1–10 gaps resolved in earlier builds (Undo, cash-advance nudge, Skip Gemini
toggle, Share ratio) — see prior build history if detail is needed.
11. Phase 11's Mark-as-Bought flow — implemented, not yet on-device tested.
12. Phase 11's split-purchase receipt matching fix — implemented in direct response to the
uploaded LS Mart receipt + Sample Grocery List bug report, not yet RE-tested on-device with
the actual fix to confirm both "Ayam" receipt lines now land correctly.
13. Phase 11's disabled Scratchpad preview unit field — implemented, not yet confirmed how it
reads on an actual phone screen.
14. **New this build**: Phase 12's Trip bar / Trip modal / Category-vs-Trip grouping toggle
have not yet been tested on-device at all. Specifically confirm:
    - Tapping the Trip bar opens the modal, "Start" creates a new trip and switches to it, and
      the bar immediately reflects the new trip's name + RM 0.00.
    - Scanning a receipt (or using Mark-as-Bought) while a given trip is active tags those items
      correctly — switch to a 2nd trip, buy/scan something else, then check the Bought tab's
      "By Trip 🏬" grouping shows two separate trip headers with correct per-trip subtotals.
    - Undo correctly clears an item's trip tag when sending it back to To Buy.
    - Pre-existing Bought items (from before this build) show under "Unassigned" in Trip view
      without errors.
15. Trip data has no delete/rename/merge UI yet — a mis-named or accidentally-created trip
currently can't be cleaned up except by clearing the entire app data. Worth a small follow-up
if trip clutter becomes an issue in practice.

## Next Prompt Should Confirm
- On-device test of Phase 12 (Trip bar, Trip modal, Start New Stop, By Trip grouping + spend
subtotals) using a real multi-stop shopping session (e.g. wet market items via Mark-as-Bought,
then a supermarket receipt scan under a 2nd trip).
- Still pending from Phase 11: re-scan the uploaded LS Mart receipt against the Sample Grocery
List to confirm the "Ayam" qty-2 split-purchase fix produces two separate Bought records.
- Still pending from earlier phases: Share ratio (Phase 10 step 4) and Skip Gemini toggle
(Phase 10 step 3) on-device tests with real data.
