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
scan with rename-on-match, dropdown-assign for unrecognized receipt lines, To Buy/Bought tabs,
qty↔price swap on scan, global backdrop-click-close. See prior builds for full detail.
- **Phase 6 (THIS BUILD — complete)**: Gemini API 429 (rate-limit/quota) mitigation.
  - **Root cause**: not a code regression — confirmed the scratchpad parsing code was
untouched. 429s were real Gemini-side rate-limiting/quota exhaustion, driven by every feature
(scratchpad parses, health checks, receipt scans) sharing one API key's one quota pool, plus
heavy testing volume during Phases 3-5.
  - **New `/api/_gemini.js`** — shared transport helper used by all three Gemini-calling
functions. Reads `GEMINI_API_KEYS` (comma-separated) with fallback to the original single
`GEMINI_API_KEY` for backward compatibility. On a `429`/`503` response, rotates to the next
configured key before failing; if every key is exhausted, does one delayed (1.2s) same-key
retry specifically for `429` (bursts often clear within a second or two) before giving up.
Splits the caller's total timeout budget across however many keys are configured (floor 6s/
attempt) so worst-case rotation still finishes inside Vercel's `maxDuration` instead of
surfacing a raw 504. Verified with 5 mocked-fetch test cases (multi-key rotation, single-key
delayed retry, full exhaustion, no-key config, non-retryable status skips rotation) — all
passing.
  - **IMPORTANT CAVEAT, must tell the user if not already understood**: key rotation only
increases real capacity if each key comes from a SEPARATE Google Cloud project (or separate
Google account). Multiple keys under the same project share one quota pool — rotating between
them still 429s at the same total request count. This was flagged to the user; awaiting
confirmation they have (or will create) multiple projects.
  - **Model tiering** — `parse-list.js` and `health.js` moved from `gemini-3.5-flash` to
`gemini-3.1-flash-lite` (confirmed GA since March 2026, ~6x cheaper, text-focused). Rationale:
these are text-only tasks, so putting them on a different model tier gives them a separate
quota pool from the vision calls in `match-receipt.js` — heavy receipt-scanning during a
shopping trip no longer starves scratchpad parsing (or vice versa) of requests on the shared
`gemini-3.5-flash` pool. `match-receipt.js` stays on `gemini-3.5-flash` — it's the
confirmed-multimodal model; flash-lite's image support wasn't established, not worth the risk
on the receipt path. `thinkingConfig: { thinkingLevel: 'low' }` was dropped from the two
flash-lite calls (that was a 3.5-flash-specific latency workaround; flash-lite may not support
the field and doesn't need it).
  - **`match-receipt.js` converted from ESM (`export default`) to CommonJS
(`module.exports`)** — for consistency with `parse-list.js`/`health.js`/`_lib.js`, which were
already CommonJS. Also restores `receiptName` on each match (present in the version built
during Phase 5, but the copy uploaded for this build's file review predated that — verified
it's back and matches what `app.js`'s `handleReceiptFile()` expects).
  - **Evaluated a user-forwarded list of 5 suggestions from Gemini itself** (native
`responseSchema`, model tiering, client-side image compression, stateless calls, local RegEx
fallback). Adopted tiering (above). Image compression and stateless calls were already true
before this build. Declined the RegEx fallback — it directly reverses an earlier deliberate
decision (scratchpad is Gemini-only so messy real input like "Ayam sekoq potong kecik" or
owner-tag detection doesn't silently degrade); offered a much narrower opt-in version instead
if still wanted. Deferred native `responseSchema` — real reliability win, but Gemini's schema
dialect (OpenAPI subset, `nullable: true` rather than JSON-Schema union types) is easy to get
wrong without a way to test against it locally, and bundling an unverified structural change
into the same deploy as a live rate-limit fix was judged too risky. Candidate for Phase 7.
  - **`sw.js` NOT bumped this build** — only `/api/*` files changed, which the service worker
already excludes from caching (see fetch handler). Per the established policy, a bump isn't
required when app.js/index.html/manifest.json are untouched.
- **Phase 7 (not started, candidates)**:
  - Native `responseSchema` for `parse-list.js` (needs careful dialect verification first).
  - Duplicate-match price overwrite (two receipt lines matching one list item) — no policy yet.
  - "Undo"/send-back-to-To-Buy action for a mis-scanned Bought item.
  - Custom shared-split ratios; cash-advance nudge for auto-created people.

## Stack
- Vanilla HTML5, Tailwind CSS (CDN), Modular Vanilla JS
- localStorage persistence
- Service Worker — stale-while-revalidate, manual skipWaiting update flow, `/api/*` excluded
from caching
- vercel.json — zero-cache headers + `functions.maxDuration` (parse-list: 30s, health: 15s,
match-receipt: 30s) — unchanged this build, still valid since per-key attempt timeouts inside
`_gemini.js` stay under these budgets regardless of how many keys are configured
- Vercel Node.js Serverless Functions in `/api/` — all CommonJS (`require`/`module.exports`)
as of this build

## File Structure
```
/index.html            -> unchanged this build.
/app.js                 -> unchanged this build (no client-side change was needed — rotation
                           and tiering are entirely server-side).
/api/_gemini.js         -> NEW this build. Shared multi-key rotation + retry transport, used
                           by all three functions below. See Phase 6 notes above.
/api/_lib.js            -> unchanged (safeJsonParse — not read/modified this build, only its
                           require() call in parse-list.js was preserved as-is).
/api/parse-list.js      -> UPDATED. Now gemini-3.1-flash-lite via callGemini(). Prompt/dedupe/
                           owner-detection logic byte-identical to before.
/api/health.js          -> UPDATED. Now gemini-3.1-flash-lite via callGemini(). Reports
                           configured key count in its message; specific 429 message with a
                           hint to add more keys.
/api/match-receipt.js   -> UPDATED. Converted ESM -> CommonJS for consistency. Uses
                           callGemini(), stays on gemini-3.5-flash. receiptName restored on
                           matches.
/manifest.json           -> unchanged
/sw.js                   -> unchanged this build (see Phase 6 notes — only /api/* changed).
/vercel.json             -> unchanged.
/icons/*.png             -> unchanged
/CLAUDE_STATE.md         -> this file
```

## Gemini API Key Rotation — SETUP INSTRUCTIONS
1. Create additional Google Cloud projects (Google Cloud Console → New Project) — one per extra
key you want real capacity from. Keys under the SAME project share one quota pool; this step
is what actually matters, not just generating more key strings.
2. In each project, enable the Gemini API and generate a key (Google AI Studio → Get API key →
"Create API key in new project", or reuse a project you just made).
3. In Vercel → Settings → Environment Variables, set:
   `GEMINI_API_KEYS = key1,key2,key3` (comma-separated, no quotes needed)
   The original `GEMINI_API_KEY` var can stay as a fallback but `GEMINI_API_KEYS` takes
priority if both are set.
4. Redeploy. `health.js`'s response will report the configured key count once it's working.

## Gemini Model String — IMPORTANT MAINTENANCE NOTE
Google retires Gemini models on a rolling cadence
(https://ai.google.dev/gemini-api/docs/deprecations). As of this build: `match-receipt.js` on
`gemini-3.5-flash`, `parse-list.js`/`health.js` on `gemini-3.1-flash-lite`. Flash-Lite naming
has moved fast (3.1 series as of writing, GA since March 2026) — check the deprecations page
before assuming a name is still current.

## Timeout Budget
```
Vercel functions.maxDuration (vercel.json)   parse-list: 30s | health: 15s | match-receipt: 30s
  └─ Total rotation budget (api/*.js -> _gemini.js)  parse-list: 22s | health: 10s | match-receipt: 22s
       └─ Per-key attempt (budget / key count, floor 6s)
            └─ Client fetch AbortController (app.js)  scratchpad: 25s | connection: 12s | receipt: 25s
```
With only 1 key configured (today's default until GEMINI_API_KEYS is set), per-key attempt
time equals the full budget — behavior is identical to before this build.

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
The "New version available" toast only fires when `sw.js`'s own byte content changes.
**Whenever a deploy changes `app.js`, `index.html`, or `manifest.json`, bump `CACHE_NAME` in
`sw.js` in the same deploy.** Deploys touching only `/api/*` (like this one) don't need it.
Last bumped: `v18` (Phase 5 build).

## Known Gaps / Next Steps
1. Confirm with the user whether their extra Gemini keys are on separate Google Cloud
projects — rotation is a no-op otherwise. This is the single most important thing to verify
before considering this fix "done" in practice.
2. Native `responseSchema` for parse-list.js — deferred, needs dialect verification.
3. Duplicate-match price overwrite — no policy yet.
4. No way to send a mis-scanned Bought item back to To Buy short of edit/delete.
5. Shared-item cost still splits evenly across all people — no custom ratio.
6. Auto-created people (from salutation detection) start with `cashAdvance: 0` — no nudge yet.
7. `appToast`/`updateToast` share screen position; FAB vertical offset on-device check.

## Setup Reminder
`GEMINI_API_KEY` (or the new `GEMINI_API_KEYS`) must be set in Vercel → Settings →
Environment Variables.

## Next Prompt Should Confirm
- Whether 429s stop after this deploy, and whether the user has set up `GEMINI_API_KEYS` with
keys from separate Google Cloud projects.
- Pick a Phase 7 item from Known Gaps, or a fresh idea.
