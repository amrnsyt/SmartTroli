// /api/match-receipt.js
// Phase 3 — Gemini Vision. Reads a photographed receipt, matches each printed line item
// against the user's existing SmartTroli list by name, and returns prices to auto-fill.
// Line items on the receipt that don't match anything in the list come back as "extras"
// (info-only in this build — tagging extras into the list is Phase 4).

const { safeJsonParse } = require('./_lib');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  const rawImage = body && typeof body.image === 'string' ? body.image : '';
  // Client may send a data: URL (e.g. "data:image/jpeg;base64,...") — strip the prefix if present.
  const base64Image = rawImage.includes(',') ? rawImage.split(',').pop() : rawImage;
  const mimeType = (body && typeof body.mimeType === 'string' && body.mimeType) ? body.mimeType : 'image/jpeg';
  const items = Array.isArray(body && body.items) ? body.items : [];

  if (!base64Image) {
    res.status(400).json({ error: 'No image provided.' });
    return;
  }
  if (items.length === 0) {
    res.status(400).json({ error: 'No existing list items provided to match against.' });
    return;
  }

  const itemsList = items
    .filter(i => i && i.id && typeof i.name === 'string')
    .map(i => `- id: "${i.id}", name: "${i.name.trim()}"`)
    .join('\n');

  const prompt = `You are a receipt-reading assistant for a Malaysian family grocery-splitting app called SmartTroli.
You are given a PHOTO of a shopping receipt and a LIST of items the user already has in their app.

The user's existing list items:
${itemsList}

Task:
1. Read every purchased line item and its price printed on the receipt. Ignore subtotal, tax,
   rounding, total, change, payment method, store name/address, and any non-item lines.
2. For each receipt line item, try to match it to ONE item from the user's existing list above by
   name — fuzzy matching is expected (abbreviations, different capitalisation, Malay/English/dialect
   spelling variants, e.g. receipt "CARROTS 1KG" should match a list item named "Carrot").
3. If it matches an existing list item, output it as a match: {"itemId": <the exact id string from
   the list above>, "price": <numeric price from the receipt, no currency symbol>}.
4. If a receipt line item does NOT reasonably match anything in the list, output it instead as an
   extra: {"name": <the item name/description as printed>, "price": <numeric price>}.
5. Never invent an item, id, or price that is not actually printed on the receipt. If the receipt is
   blurry or a line is unreadable, skip that line rather than guessing.
6. Each list item id should be matched at most once — pick its single best matching receipt line.

Output ONLY a JSON object of the exact shape: {"matches": [...], "extras": [...]} — no markdown
fences, no extra commentary.`;

  try {
    // Same timeout budget convention as /api/parse-list.js: in-file abort (22s) fires before
    // vercel.json's functions.maxDuration (30s) so a slow response returns our own clean JSON
    // error instead of Vercel's raw 504. thinkingLevel: "low" keeps gemini-3.5-flash's default
    // reasoning pass from adding unnecessary latency here too (see parse-list.js's note).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: 'low' }
          }
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: 'Gemini API error', detail: errText });
      return;
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
      res.status(502).json({ error: 'Gemini returned no content.' });
      return;
    }

    // NOTE (Phase 2.14): same thought-leak fix as parse-list.js — see api/_lib.js.
    let parsed;
    try {
      parsed = safeJsonParse(raw);
    } catch (e) {
      res.status(502).json({ error: 'Gemini returned unparseable JSON.', raw });
      return;
    }

    const validIds = new Set(items.map(i => i.id));
    const matches = Array.isArray(parsed?.matches)
      ? parsed.matches
          .filter(m => m && validIds.has(m.itemId) && !isNaN(parseFloat(m.price)))
          .map(m => ({ itemId: m.itemId, price: parseFloat(m.price) }))
      : [];
    const extras = Array.isArray(parsed?.extras)
      ? parsed.extras
          .filter(e => e && typeof e.name === 'string' && e.name.trim() && !isNaN(parseFloat(e.price)))
          .map(e => ({ name: e.name.trim(), price: parseFloat(e.price) }))
      : [];

    res.status(200).json({ matches, extras });
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Gemini took too long to read the receipt (server-side timeout after 22s).' });
      return;
    }
    res.status(500).json({ error: 'Server error calling Gemini.', detail: String(err) });
  }
};
