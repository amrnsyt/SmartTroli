// /api/parse-list.js
// Vercel Node.js Serverless Function — auto-detected, zero build step.
// Reads GEMINI_API_KEY / GEMINI_API_KEYS from Vercel Environment Variables (never sent to the client).

const { safeJsonParse } = require('./_lib');
const { callGemini } = require('./_gemini');

// Native structured-output schema (Gemini REST API's OpenAPI-subset dialect — uppercase `type`
// strings, `nullable: true` for optional fields). Constrains Gemini's output to exactly this
// shape at generation time, instead of relying on the prompt's plain-English JSON description
// alone. safeJsonParse() (below) is kept as a defensive fallback rather than removed — schema
// mode should eliminate the leaked-reasoning-text problem it was built for, but there's no way
// to verify that against the live environment from here, so no reason to drop a working safety
// net over an assumption.
const responseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      qty: { type: 'NUMBER', nullable: true },
      unit: { type: 'STRING' },
      price: { type: 'NUMBER' },
      category: { type: 'STRING' },
      ownerName: { type: 'STRING', nullable: true }
    },
    required: ['name', 'qty', 'unit', 'price', 'category', 'ownerName']
  }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.GEMINI_API_KEYS && !process.env.GEMINI_API_KEY) {
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
    // Model tiering (this build): scratchpad parsing is a text-only extraction task, so it
    // runs on gemini-3.1-flash-lite instead of gemini-3.5-flash. Two reasons: (1) it's on a
    // separate quota pool from the vision calls in match-receipt.js, so heavy receipt-scanning
    // during a shopping trip doesn't also starve scratchpad parsing of requests, and (2) it's
    // ~6x cheaper per Google's published pricing, which matters if this moves to a paid tier.
    // If 404s ever return, check https://ai.google.dev/gemini-api/docs/deprecations for the
    // current GA lite model — Flash-Lite naming has moved fast (3.1 series as of writing).
    //
    // NOTE: no thinkingConfig here — Flash-Lite is built for low latency already and may not
    // support the thinkingConfig field at all (that was specifically a gemini-3.5-flash
    // workaround, see the matching NOTE in health.js history / CLAUDE_STATE.md).
    //
    // callGemini() (api/_gemini.js) rotates across every key in GEMINI_API_KEYS on a 429/503
    // before giving up, splitting this 22s budget across however many keys are configured.
    const response = await callGemini('gemini-3.1-flash-lite', {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.2
      }
    }, 22000);

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

    // safeJsonParse() (api/_lib.js) strips any leaked reasoning text ahead of the real JSON —
    // unchanged from before, this file's own logic here didn't need to change.
    let items;
    try {
      items = safeJsonParse(raw);
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
      res.status(504).json({ error: 'Gemini took too long to respond (server-side timeout).' });
      return;
    }
    if (err.name === 'NoKeyError') {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: 'Server error calling Gemini.', detail: String(err) });
  }
};
