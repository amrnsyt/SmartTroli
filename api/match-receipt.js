export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed', reason: 'method' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY', reason: 'config' });
    return;
  }

  const { image, mimeType, itemNames } = req.body || {};
  if (!image || typeof image !== 'string') {
    res.status(400).json({ error: 'No receipt image provided', reason: 'input' });
    return;
  }

  const knownItems = Array.isArray(itemNames) ? itemNames.filter(Boolean) : [];

  const prompt = `You are reading a Malaysian grocery/supermarket receipt photo.
Extract every purchased line item you can read, with its final price in Ringgit (RM).
Ignore subtotal, tax, discount, rounding, and total lines — only return individual purchased items.
Return STRICT JSON only, no markdown, no commentary, in this exact shape:
{"items":[{"name":"string","price":number}]}
Names should be the plain product name as printed (no SKU codes, no quantity prefix unless it's part of the name).
If the photo is unreadable, blurry, or is not a receipt, return {"items":[]}.

For reference, here is the shopper's current grocery list (use this ONLY to help you resolve
ambiguous/abbreviated receipt names to a fuller name when confident — do not invent items that
aren't on the receipt):
${knownItems.join(', ') || '(list is empty)'}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType || 'image/jpeg', data: image } }
              ]
            }
          ],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
        })
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      res.status(502).json({ error: `Gemini API error (${response.status}): ${errText.slice(0, 300)}`, reason: 'api' });
      return;
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{"items":[]}';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: 'Gemini returned malformed JSON', reason: 'parse' });
      return;
    }

    const receiptItems = Array.isArray(parsed.items) ? parsed.items : [];

    const normalize = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();

    const normalizedKnown = knownItems.map((n) => ({ original: n, norm: normalize(n) }));

    const matched = [];
    const unmatched = [];

    for (const ri of receiptItems) {
      const riName = String(ri.name || '').trim();
      const riPrice = Number(ri.price);
      if (!riName || Number.isNaN(riPrice)) continue;

      const normRi = normalize(riName);
      let best = null;
      for (const k of normalizedKnown) {
        if (!k.norm) continue;
        if (k.norm === normRi) { best = k; break; }
        if (k.norm.includes(normRi) || normRi.includes(k.norm)) {
          if (!best) best = k;
        }
      }

      if (best) {
        matched.push({ listName: best.original, receiptName: riName, price: riPrice });
      } else {
        unmatched.push({ name: riName, price: riPrice });
      }
    }

    res.status(200).json({ matched, unmatched });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Gemini took too long to read the receipt (timeout)', reason: 'timeout' });
      return;
    }
    res.status(502).json({ error: 'Could not reach Gemini', reason: 'network' });
  }
}
