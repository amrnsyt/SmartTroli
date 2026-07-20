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
    const timeout = setTimeout(() => controller.abort(), 10000);

    // NOTE (Phase 2.11): thinkingLevel: 'low' avoids gemini-3.5-flash's default medium-thinking
    // latency, which was slow enough on its own to make even this trivial ping time out.
    // See the matching note in parse-list.js for the full explanation.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 32, thinkingConfig: { thinkingLevel: 'low' } }
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
