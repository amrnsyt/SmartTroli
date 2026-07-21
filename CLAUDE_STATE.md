# CLAUDE_STATE.md — SmartTroli (KongsiTroli) — Project Memory

## Product Vision (Full Concept)
SmartTroli/KongsiTroli eliminates friction in coordinating, checking off, and dividing grocery
expenses within families/shared households. AI (Gemini) turns chaotic WhatsApp lists into a
clean, categorized, per-person shared checklist and a single settlement instruction
("Arahan Malas"). Lists start QUANTITY-first — prices are added at the shelf/checkout, and a
receipt scan is what confirms an item as actually bought. Real shopping happens across
multiple stops, so the list is split into To Buy / Bought rather than one flat list forever.

## Phase Roadmap
- **Phase 1–5 (complete)**: settlement engine, Gemini-only scratchpad, Gemini Vision receipt
scan with rename-on-match, dropdown-assign, To Buy/Bought tabs, qty↔price swap, global
backdrop-click-close. See prior builds for full detail.
- **Phase 6 (complete)**: `/api/_gemini.js` shared multi-key rotation + retry helper (rotates
on 429/503, one delayed retry on the final key for 429, budget split across configured keys).
`parse-list.js`/`health.js` moved to `gemini-3.1-flash-lite`. `match-receipt.js` converted
ESM->CommonJS, `receiptName` restored on matches.
- **Phase 7 (THIS BUILD — complete)**: correction + real-world guidance, receipt scan was
still 429ing after Phase 6.
  - **Root cause of the continued 429**: Phase 6 kept `match-receipt.js` on
`gemini-3.5-flash` out of caution ("flash-lite's image support isn't established" — turned out
to be wrong). Verified via Google's own docs this build: `gemini-3.1-flash-lite` is
confirmed multimodal and Google explicitly lists **receipt processing** as a target use case
for it. So receipt scans — the single heaviest-token call of the three features (an image is
far more tokens than a scratchpad text block) — were the one thing left hitting the
expensive/lower-headroom `gemini-3.5-flash` pool. Moved to `gemini-3.1-flash-lite`, same tier
as the other two calls now.
  - **All three Gemini-calling functions are now on `gemini-3.1-flash-lite`.** There is
currently no feature left on `gemini-3.5-flash` in this app. If a future feature genuinely
needs frontier-tier reasoning `gemini-3.5-flash` is still there to reach for, but none of the
current three (scratchpad parse, health ping, receipt OCR+match) need more than flash-lite
provides.
  - **Told the user directly**: code-level mitigation (rotation, tiering, retry-with-backoff)
reduces *how often* 429s happen and *how gracefully* they're handled, but cannot eliminate them
outright on a free-tier key with real daily usage — a free tier has a hard request-per-day
ceiling no amount of client cleverness gets around. The only way to fully remove 429 as a
possibility is enabling billing (pay-as-you-go) on the Google Cloud project(s) behind the
key(s) — Gemini Flash-Lite pricing is low enough that normal personal/family usage of this app
would cost a small fraction of a dollar per month. Multi-key rotation across separate free
projects is a reasonable stopgap short of that, but has a ceiling of its own (finite number of
projects one person will practically create).
  - **Open question sent back to the user, not yet answered**: whether they've actually set
`GEMINI_API_KEYS` with keys from separate Google Cloud projects yet, or are still running on
the single original `GEMINI_API_KEY` — this determines whether Phase 6's rotation logic is
doing anything yet or is still a no-op with one key in the array.
- **Phase 8 (THIS BUILD — complete)**: 503 during receipt scan, after confirming `GEMINI_API_KEYS`
was set up correctly (3 keys, 3 separate Google Cloud projects, redeployed).
  - **503 is a different failure mode from 429** — it means Gemini's model is momentarily
overloaded on Google's infrastructure side, not that any particular key/project is
rate-limited. Rotating to a different key/project doesn't reliably help here, since it's
likely the same underlying model regardless of which key hits it.
  - `/api/_gemini.js`'s final-key fallback previously only did a delayed retry for `429`
(one retry, 1.2s delay). Widened this build to also cover `503`, with **two** delayed retries
(1.2s then 3s) instead of one, since overload spikes can take a bit longer to clear than a
rate-limit window. Verified with 2 new mocked-fetch tests: gives up cleanly after exactly 3
total attempts (initial + 2 retries) when 503 persists throughout; recovers correctly if the
2nd retry succeeds. All previous Phase 6 tests re-verified passing too.
  - Key rotation (Phase 6) is still valuable for 429 specifically — kept as the first line of
defense before the delayed-retry fallback, unchanged.
- **Phase 9 (THIS BUILD — complete, step 1 of 3)**: analyzed a separate prior project
(`Shoppy-With-Wifey`, React/TS/Vite/Firebase, different app entirely) at the user's request to
understand why its receipt-scan + item-match felt more reliable. Findings:
  1. Uses native `responseSchema` (typed, `required` fields) via the official `@google/genai`
SDK, not just `responseMimeType: json` + prompt instructions — structurally constrains
Gemini's output instead of hoping it's followed.
  2. Splits OCR (vision) and item-matching (text-only) into two separate Gemini calls, and
lets Gemini itself do the matching (including cross-language synonyms) with server-side
`usedIds` dedup — rather than one combined vision call followed by hand-rolled JS fuzzy-string
matching, which is what caused SmartTroli's duplicate-match bug and the need for a manual
dropdown-assign UI as a workaround.
  3. Falls back to local Tesseract OCR + regex automatically if the Gemini call fails, so a
quota/outage day degrades gracefully instead of dead-ending in an error.
  4. Runs on the older `gemini-2.5-flash` — likely less-contended free-tier quota right now
simply because fewer people are on that generation.
  - Agreed to port these in priority order, one at a time, starting with #1.
  - **Step 1/3 (this build): native `responseSchema` added to `parse-list.js`.** Schema
mirrors the existing `{name, qty, unit, price, category, ownerName}` item shape exactly, with
`qty`/`ownerName` marked `nullable: true` (both are legitimately null in normal operation — no
quantity stated, or no owner detected). `safeJsonParse()`'s leaked-reasoning-text stripping
was deliberately left in place as a defensive fallback rather than removed, since schema mode
should make it unnecessary but that can't be verified without the live environment.
  - **Steps 2/3 and 3/3 not yet started** (split match-receipt.js into OCR + separate
text-only match call with dedup; local-fallback resilience for a Gemini outage) — next up,
one at a time per the user's request.
- **Phase 10 (not started, candidates)**:
  - Phase 9 steps 2 and 3 (see above).
  - Duplicate-match price overwrite in the CURRENT match-receipt.js — likely moot once step 2
lands (server-side dedup replaces the JS substring matcher entirely), but flagging in case
step 2 gets deprioritized.
  - "Undo"/send-back-to-To-Buy action for a mis-scanned Bought item.
  - Custom shared-split ratios; cash-advance nudge for auto-created people.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: 30s) — unchanged, still valid regardless of model/key-count changes
- Vercel Node.js Serverless Functions in `/api/` — all CommonJS

## File Structure
```
/index.html            -> unchanged this build.
/app.js                 -> unchanged this build.
/api/_gemini.js         -> unchanged this build (built in Phase 6).
/api/_lib.js            -> unchanged, not modified any build so far.
/api/parse-list.js      -> UPDATED this build. Native responseSchema added (see Phase 9). Model
                           unchanged (gemini-3.1-flash-lite, since Phase 7).
/api/health.js           -> unchanged this build.
/api/match-receipt.js   -> unchanged this build (Phase 9 step 2 will restructure this file
                           next — not started yet).
/manifest.json           -> unchanged
/sw.js                   -> unchanged (only /api/* touched, service worker doesn't cache it).
/vercel.json             -> unchanged.
/icons/*.png             -> unchanged
/CLAUDE_STATE.md         -> this file
```

## Gemini API Key Rotation — CONFIRMED SET UP (as of Phase 8)
User confirmed: 3 keys, from 3 separate Google Cloud projects, `GEMINI_API_KEYS` set in Vercel,
redeployed. Rotation is live, not a no-op. Reference setup steps kept below for future
additions.
1. Create additional Google Cloud projects — one per extra key wanted. Keys under the SAME
project share one quota pool; this step is what actually matters.
2. In each project, enable the Gemini API and generate a key.
3. Vercel → Settings → Environment Variables: `GEMINI_API_KEYS = key1,key2,key3`
(comma-separated). Falls back to `GEMINI_API_KEY` if unset.
4. Redeploy. `health.js`'s response reports the configured key count.
5. **For a permanent fix rather than a stopgap**: enable billing on the Google Cloud
project(s) instead of/in addition to rotation. Flash-Lite pricing is low enough that normal
usage costs a small fraction of a dollar per month — this is the only option that removes the
429 ceiling entirely rather than just raising it.

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). As of this build: ALL THREE API files
(`parse-list.js`, `health.js`, `match-receipt.js`) are on `gemini-3.1-flash-lite`. Check the
deprecations page before assuming this name stays current — Flash-Lite naming has moved fast
(3.1 series as of writing, GA since March 2026).

## Timeout Budget
```
Vercel functions.maxDuration (vercel.json)   parse-list: 30s | health: 15s | match-receipt: 30s
  └─ Total rotation budget (api/*.js -> _gemini.js)  parse-list: 22s | health: 10s | match-receipt: 22s
       └─ Per-key attempt (budget / key count, floor 6s)
            └─ Client fetch AbortController (app.js)  scratchpad: 25s | connection: 12s | receipt: 25s
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

## Service Worker Update-Popup Policy — IMPORTANT
Bump `CACHE_NAME` in `sw.js` whenever `app.js`/`index.html`/`manifest.json` change. Not needed
for `/api/*`-only deploys (like this one). Last bumped: `v18` (Phase 5 build).

## Known Gaps / Next Steps
1. Phase 9 step 2: split match-receipt.js into OCR-only + separate text-only match call
(server-side dedup, cross-language matching) — this is the next thing to build.
2. Phase 9 step 3: local-fallback resilience for a Gemini outage during receipt scanning.
3. Duplicate-match price overwrite — likely resolved once step 2 lands.
4. No way to send a mis-scanned Bought item back to To Buy short of edit/delete.
5. Shared-item cost still splits evenly across all people — no custom ratio.
6. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
7. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.

## Setup Reminder
`GEMINI_API_KEY` (or `GEMINI_API_KEYS`) must be set in Vercel → Settings → Environment
Variables.

## Next Prompt Should Confirm
- Ready to build Phase 9 step 2 (split match-receipt.js + separate matching call)?
