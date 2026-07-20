// /api/health.js
// Lightweight GET endpoint the app pings to verify the Gemini API key is set
// and Gemini is actually reachable — used by the "Check connection" dot in the UI.

module.exports = async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.status(200).json({ ok: false, message: 'GEMINI_API_KEY is not set on the server (check Vercel env vars).' });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    // NOTE: Google retires Gemini models on a fast, rolling cadence (see
    // https://ai.google.dev/gemini-api/docs/deprecations). If this starts 404ing again,
    // check that page for the current GA "flash" model and update the URL below.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 5 }
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    if (response.status === 400 || response.status === 403) {
      res.status(200).json({ ok: false, message: 'Gemini rejected the API key (invalid or restricted).' });
      return;
    }
    if (!response.ok) {
      const detail = await response.text();
      res.status(200).json({ ok: false, message: `Gemini API error (${response.status}).`, detail });
      return;
    }

    res.status(200).json({ ok: true, message: 'Gemini connection OK.' });
  } catch (err) {
    res.status(200).json({ ok: false, message: 'Could not reach Gemini from the server (network/timeout).' });
  }
};
