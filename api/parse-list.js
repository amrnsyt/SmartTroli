// /api/parse-list.js
// Vercel Node.js Serverless Function — auto-detected, zero build step.
// Reads GEMINI_API_KEY from a Vercel Environment Variable (never sent to the client).

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
  const text = (body && body.text ? String(body.text) : '').trim();

  if (!text) {
    res.status(400).json({ error: 'No text provided.' });
    return;
  }

  const prompt = `You are a grocery-list parser for a Malaysian family shopping app called SmartTroli.
The input below is a messy, unstructured shopping list — possibly mixing English, Malay, and local dialect, possibly copy-pasted from WhatsApp, possibly containing duplicate items that should be combined.

IMPORTANT — this is a PRE-SHOPPING list. Prices are usually NOT known yet. Capture items primarily
by QUANTITY, not price.

Rules:
- Extract each distinct grocery item as {"name": string, "qty": number, "unit": string, "price": number}.
- "qty" is the quantity mentioned (e.g. "2 ekor" -> qty 2, unit "ekor"; "3 batang" -> qty 3, unit "batang").
  If no quantity is mentioned, default qty to 1.
- "unit" is the local unit word if present (ekor, batang, biji, kg, g, ml, l, pcs, bungkus, kotak, tin, botol, etc).
  Use "" if no unit is mentioned.
- "price" should ONLY be set if an explicit price (e.g. "RM12", "12.50") appears in that line. If no
  price is given, set price to 0 — do NOT invent or estimate a price.
- If the same item appears more than once (even with slightly different wording, e.g. "ayam sekoq" and
  "ayam sekoq potong kecik"), combine them into ONE entry, summing their qty (only sum price if both
  had explicit prices).
- Keep item names short, human-readable, and in the language/style the user wrote them (do not translate).
- Ignore lines that are clearly not grocery items (greetings, notes, etc.).
- Output ONLY a JSON array of objects, no markdown fences, no extra commentary.

Input list:
"""
${text}
"""`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      }
    );

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

    let items;
    try {
      items = JSON.parse(raw);
    } catch (e) {
      res.status(502).json({ error: 'Gemini returned unparseable JSON.', raw });
      return;
    }

    if (!Array.isArray(items)) {
      res.status(502).json({ error: 'Gemini response was not a list.' });
      return;
    }

    const cleaned = items
      .filter(i => i && typeof i.name === 'string' && i.name.trim())
      .map(i => ({
        name: i.name.trim(),
        qty: parseFloat(i.qty) || 1,
        unit: typeof i.unit === 'string' ? i.unit.trim() : '',
        price: parseFloat(i.price) || 0
      }));

    res.status(200).json({ items: cleaned });
  } catch (err) {
    res.status(500).json({ error: 'Server error calling Gemini.', detail: String(err) });
  }
};
