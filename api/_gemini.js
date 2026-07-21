// /api/_gemini.js
// Shared Gemini transport used by parse-list.js, health.js, and match-receipt.js.
// Owns ONLY key rotation + timeouts — callers still build their own prompt/body and handle
// the response exactly as before (response.ok checks, status codes, etc. all unchanged).
//
// IMPORTANT — read before assuming this "fixes" quota: rotation only helps if each key is on
// a SEPARATE Google Cloud project (or separate Google account). Multiple keys generated under
// the SAME project share one quota pool — rotating between them still 429s at the same total
// request count. See CLAUDE_STATE.md "Gemini API Key Rotation" for setup instructions.

function getApiKeys() {
  // Preferred: GEMINI_API_KEYS="key1,key2,key3" (comma-separated; whitespace around each key
  // is trimmed). Falls back to the original single GEMINI_API_KEY so nothing breaks for
  // anyone who hasn't set up multiple keys/projects yet.
  const multi = process.env.GEMINI_API_KEYS;
  if (multi && multi.trim()) {
    return multi.split(',').map((k) => k.trim()).filter(Boolean);
  }
  const single = process.env.GEMINI_API_KEY;
  return single ? [single] : [];
}

const RETRYABLE_STATUS = new Set([429, 503]); // 429 = rate/quota limited, 503 = model overloaded
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls Gemini's generateContent endpoint, rotating through every configured key on a 429/503
// before giving up. Returns a normal fetch Response on success OR on any non-retryable
// failure OR once every key is exhausted (so callers keep doing `if (!response.ok) {...}`
// exactly like before) — only throws for network errors / a timeout on the final attempt,
// same as a plain fetch() would.
//
// `totalBudgetMs` is the WHOLE rotation's time budget, not per-attempt — it gets split across
// however many keys are configured (floor 6s per attempt) so that even the worst case (every
// key rate-limited) still finishes inside the caller's own timeout instead of blowing past
// Vercel's maxDuration and surfacing a raw 504 instead of our own clean JSON error. With only
// one key configured (the common case today), this is identical to the old single fetch().
async function callGemini(model, body, totalBudgetMs) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    const err = new Error('No Gemini API key configured (set GEMINI_API_KEYS or GEMINI_API_KEY on Vercel).');
    err.name = 'NoKeyError';
    throw err;
  }

  const perAttemptMs = Math.max(6000, Math.floor(totalBudgetMs / keys.length));

  async function attempt(key) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), perAttemptMs);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  let lastNetworkError = null;

  for (let i = 0; i < keys.length; i++) {
    const isLastKey = i === keys.length - 1;
    try {
      const response = await attempt(keys[i]);

      if (response.ok || !RETRYABLE_STATUS.has(response.status)) {
        return response; // success, or a non-retryable error — final answer either way
      }

      if (!isLastKey) continue; // retryable status, more keys to fall through to

      // Out of keys. For 429 specifically (not 503), momentary bursts often clear within a
      // second or two even on the same key — worth exactly one short delayed retry before
      // truly giving up, rather than failing on the very first rate-limit hit.
      if (response.status === 429) {
        await sleep(1200);
        return attempt(keys[i]);
      }
      return response;
    } catch (err) {
      if (isLastKey) throw err; // network error / timeout on the last key — surface as-is
      lastNetworkError = err; // this key errored — try the next one
    }
  }

  // Unreachable in practice (the loop always returns/throws on the last key), but keep a safe
  // fallback rather than an implicit `undefined` return.
  throw lastNetworkError || new Error('Gemini request failed for an unknown reason.');
}

module.exports = { callGemini, getApiKeys };
