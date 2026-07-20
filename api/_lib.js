// /api/_lib.js
// Shared helpers for the Gemini-backed functions. Vercel does not turn underscore-prefixed
// files under /api into routes, but they can still be require()'d from sibling functions.

// Gemini 3.x models "think" before answering (see parse-list.js's Phase 2.11 note). A known,
// documented quirk (googleapis/python-genai#2121) is that thought/reasoning content can leak
// into the regular answer text — even with responseMimeType: 'application/json' and even when
// no part is actually flagged `thought: true` — instead of staying cleanly separated. That
// turns "valid JSON" into "some leaked reasoning text, then the real JSON," which is why
// JSON.parse(raw) alone started failing on this build (it worked fine before Phase 2.11 added
// thinkingConfig, because gemini-1.5-flash never had a thinking pass to leak in the first
// place). This parser tries a plain parse first, then falls back to locating the actual
// JSON value inside whatever text Gemini returned, instead of assuming the whole string is
// clean JSON.
function safeJsonParse(raw) {
  const tryParse = (s) => { try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false }; } };

  let attempt = tryParse(raw);
  if (attempt.ok) return attempt.value;

  let cleaned = raw.trim();

  // Strip a markdown code fence if the model added one despite responseMimeType.
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
    attempt = tryParse(cleaned);
    if (attempt.ok) return attempt.value;
  }

  // Locate the real JSON value (array or object, whichever starts first) inside any leaked
  // text surrounding it, and parse just that slice.
  const firstBracket = cleaned.indexOf('[');
  const firstBrace = cleaned.indexOf('{');
  let start = -1;
  let closeChar = '';
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    closeChar = ']';
  } else if (firstBrace !== -1) {
    start = firstBrace;
    closeChar = '}';
  }

  if (start !== -1) {
    const end = cleaned.lastIndexOf(closeChar);
    if (end > start) {
      attempt = tryParse(cleaned.slice(start, end + 1));
      if (attempt.ok) return attempt.value;
    }
  }

  throw new Error('Could not locate valid JSON in the Gemini response.');
}

module.exports = { safeJsonParse };
