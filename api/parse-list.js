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
The input below is a messy, unstructured shopping list — possibly mixing English, Malay, and local dialect,
possibly copy-pasted from WhatsApp, and possibly containing SEPARATE SECTIONS for different family members
(e.g. a section starting with "Abah :", "Mak:", "Kak Ani -" etc — a name/salutation followed by a colon or
dash, on its own line).

IMPORTANT — this is a PRE-SHOPPING list. Prices are usually NOT known yet. Capture items primarily
by QUANTITY, not price.

Rules:
- Extract each distinct grocery item as:
  {"name": string, "qty": number|null, "unit": string, "price": number, "category": string, "ownerName": string|null}
- SALUTATION / OWNER DETECTION: if a line is just a person's name/salutation (optionally followed by ":" or
  "-", with nothing else on that line, e.g. "Abah :", "Mak:"), treat it as a section header. Do NOT emit it
  as a grocery item — exclude it from the output entirely. Every item listed AFTER that header (until the
  next header or end of list) should have "ownerName" set to that person's name. Items before any header
  (i.e. the main/shared list at the top) should have "ownerName": null.
- "qty": the quantity mentioned (e.g. "2 ekor" -> qty 2, unit "ekor"; "UBI 3 BIJI" -> qty 3, unit "BIJI";
  "CARROT 1" -> qty 1, unit ""). If NO quantity is mentioned anywhere in the line (e.g. just "KICAP" or
  "PISANG"), set "qty" to null — do NOT default it to 1. Never guess a quantity that isn't there.
- "unit": the local unit word if present (ekor, batang, biji, kg, g, ml, l, pcs, bungkus, kotak, tin, botol,
  etc). Use "" if no unit is mentioned.
- "price": ONLY set if an explicit price (e.g. "RM12", "12.50") appears in that line. Otherwise 0 — never
  invent or estimate a price.
- "category": classify the item into ONE of these categories (use the closest match):
  "Sayur-sayuran" (vegetables), "Buah-buahan" (fruits), "Daging & Ayam" (meat/poultry),
  "Ikan & Makanan Laut" (fish/seafood), "Tenusu" (dairy), "Perencah & Sos" (condiments/sauces/spices),
  "Lain-lain" (anything else, e.g. household items).
- DEDUPE — this is important, read carefully: if the SAME item name appears more than once
  ANYWHERE in the input (even with slightly different wording, e.g. "ayam sekoq" and "ayam sekoq
  potong kecik", and REGARDLESS of whether they came from the main list or from different
  people's sections), combine them into ONE entry:
  - Sum their quantities. If a particular mention had no stated qty, count that mention as 1 for
    the purpose of this sum (e.g. "Carrot 1" in the main list + "carrot" with no number under
    "Abah :" -> combined qty = 2). Only leave "qty" as null if the item appears just ONCE in the
    whole input AND that single mention had no stated quantity.
  - Sum price only for mentions that had an explicit price.
  - If all merged mentions came from the SAME owner (or all had no owner), keep that ownerName.
    If they came from DIFFERENT owners (e.g. one from the main/shared list and one from "Abah :",
    or from two different people), set "ownerName" to the literal string "Shared" — this signals
    the item should go into the app's shared/kongsi bucket since more than one person needs it.
- Keep item names short, human-readable, and in the language/style the user wrote them (do not translate,
  strip emoji like 🥕).
- Ignore lines that are clearly not grocery items (greetings, notes, etc.) and are not a valid salutation header.
- Output ONLY a JSON array of objects, no markdown fences, no extra commentary.

Input list:
"""
${text}
"""`;

  try {
    // NOTE (Phase 2.11): gemini-3.5-flash has "thinking" ON by default (thinkingLevel:
    // "medium"), which was adding enough per-request reasoning latency to blow past our
    // 22s in-file abort / 30s Vercel maxDuration and surface as a raw 504. thinkingLevel:
    // "low" (Gemini 3 series can't fully disable thinking, unlike 2.5's thinkingBudget:0)
    // keeps this fast enough for a JSON-extraction task. If 404s return, check
    // https://ai.google.dev/gemini-api/docs/deprecations for the current GA flash model.
    // Explicit timeout, kept comfortably under this function's vercel.json maxDuration (30s),
    // so a slow Gemini response returns our own clean JSON error instead of Vercel's raw 504.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
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
        qty: (i.qty === null || i.qty === undefined || i.qty === '') ? null : (parseFloat(i.qty) || null),
        unit: typeof i.unit === 'string' ? i.unit.trim() : '',
        price: parseFloat(i.price) || 0,
        category: typeof i.category === 'string' && i.category.trim() ? i.category.trim() : 'Lain-lain',
        ownerName: (typeof i.ownerName === 'string' && i.ownerName.trim()) ? i.ownerName.trim() : null
      }));

    res.status(200).json({ items: cleaned });
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Gemini took too long to respond (server-side timeout after 22s).' });
      return;
    }
    res.status(500).json({ error: 'Server error calling Gemini.', detail: String(err) });
  }
};
