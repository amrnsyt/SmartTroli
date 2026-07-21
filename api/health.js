// /api/health.js
// Lightweight GET endpoint the app pings to verify a Gemini API key is set and Gemini is
// actually reachable — used by the "Check connection" dot in the UI.

const { callGemini, getApiKeys } = require('./_gemini');

module.exports = async function handler(req, res) {
  const keys = getApiKeys();

  if (keys.length === 0) {
    res.status(200).json({ ok: false, message: 'No Gemini API key set on the server (set GEMINI_API_KEYS or GEMINI_API_KEY in Vercel env vars).' });
    return;
  }

  try {
    // Same tiering as parse-list.js: this is a trivial text ping, so it runs on the cheaper
    // gemini-3.1-flash-lite rather than gemini-3.5-flash — keeps it off the same quota pool
    // as receipt-scanning vision calls. No thinkingConfig — Flash-Lite doesn't need it and may
    // not support the field.
    const response = await callGemini('gemini-3.1-flash-lite', {
      contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
      generationConfig: { maxOutputTokens: 32 }
    }, 10000);

    if (response.status === 400 || response.status === 403) {
      res.status(200).json({ ok: false, message: 'Gemini rejected the API key (invalid or restricted).' });
      return;
    }
    if (response.status === 429) {
      res.status(200).json({
        ok: false,
        message: keys.length > 1
          ? `All ${keys.length} configured Gemini keys are rate-limited/quota-exhausted right now.`
          : 'Gemini key is rate-limited or has hit its quota. Add more keys (GEMINI_API_KEYS) on separate Google Cloud projects to increase capacity.'
      });
      return;
    }
    if (!response.ok) {
      const detail = await response.text();
      res.status(200).json({ ok: false, message: `Gemini API error (${response.status}).`, detail });
      return;
    }

    res.status(200).json({
      ok: true,
      message: keys.length > 1 ? `Gemini connection OK (${keys.length} keys configured).` : 'Gemini connection OK.'
    });
  } catch (err) {
    res.status(200).json({ ok: false, message: 'Could not reach Gemini from the server (network/timeout).' });
  }
};
