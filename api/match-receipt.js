// /api/match-receipt.js
// Vercel Node.js Serverless Function — Phase 9 step 2, upgraded Phase 11.
// Split into TWO Gemini calls instead of one combined vision+match call:
//   1) OCR-only (vision): read the receipt photo, extract {name, price} lines. This call
//      knows nothing about the shopper's list.
//   2) Match-only (text): given the OCR'd lines + the shopper's current To Buy list, Gemini
//      itself decides which receipt line maps to which list item (handles synonyms/abbrevs/
//      cross-language, e.g. "AYAM SEGAR/KG" -> "Ayam"), enforcing a per-item quantity cap
//      itself via the prompt, with a server-side dedup pass as a safety net.
//
// Phase 11: a list item can be a MERGED entry (qty > 1) combining requests from more than one
// person (e.g. "Ayam" qty 2 — one request from the main list, one from "Abah :"). Such an item
// can legitimately be fulfilled by MORE THAN ONE receipt line (e.g. two separately-weighed
// chicken purchases). The old logic capped every list item at exactly ONE matching receipt
// line, which meant the 2nd genuine purchase got shoved into "extras" as unrecognized instead
// of being recognized as the same item's 2nd unit. The cap is now the item's own qty (floored,
// minimum 1) instead of a flat 1-per-item limit.

const { callGemini } = require('./_gemini');
const { safeJsonParse } = require('./_lib');

const ocrSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      price: { type: 'NUMBER' }
    },
    required: ['name', 'price']
  }
};

const matchSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      receiptName: { type: 'STRING' },
      price: { type: 'NUMBER' },
      matchedItemId: { type: 'STRING', nullable: true }
    },
    required: ['receiptName', 'price', 'matchedItemId']
  }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.GEMINI_API_KEYS && !process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: 'Server is missing GEMINI_API_KEY' });
    return;
  }

  const { image, mimeType, items } = req.body || {};
  if (!image || typeof image !== 'string') {
    res.status(400).json({ error: 'No receipt image provided' });
    return;
  }

  // app.js sends a full data URL — Gemini's inline_data.data wants only the raw base64 payload.
  const base64Data = image.includes(',') ? image.split(',')[1] : image;

  // app.js sends [{id, name, qty}] — qty (Phase 11) drives how many receipt lines are allowed
  // to match the same list item.
  const knownItems = Array.isArray(items) ? items.filter((i) => i && i.id && i.name) : [];

  try {
    // ---- Step 1: OCR only (vision, no list context). ----
    const ocrPrompt = `You are reading a Malaysian grocery/supermarket receipt photo.
Extract every purchased line item you can read, with its final price in Ringgit (RM).
Ignore subtotal, tax, discount, rounding, member points, and total lines — only individual purchased items.
Names should be the plain product name as printed (no SKU codes, no quantity prefix unless it's part of the name).
If the photo is unreadable, blurry, or is not a receipt, return an empty array.
Output ONLY a JSON array, no markdown, no commentary.`;

    const ocrResponse = await callGemini('gemini-3.1-flash-lite', {
      contents: [{
        parts: [
          { text: ocrPrompt },
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Data } }
        ]
      }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: ocrSchema }
    }, 13000);

    if (!ocrResponse.ok) {
      const errText = await ocrResponse.text().catch(() => '');
      res.status(502).json({ error: `Gemini OCR error (${ocrResponse.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const ocrData = await ocrResponse.json();
    const ocrRaw = ocrData?.candidates?.[0]?.content?.parts?.[0]?.text;

    let receiptLines = [];
    if (ocrRaw) {
      try {
        const parsed = safeJsonParse(ocrRaw);
        if (Array.isArray(parsed)) receiptLines = parsed;
      } catch (e) {
        // Treat as "nothing readable" rather than a hard failure — an unreadable photo is a
        // normal outcome, not a server error.
        receiptLines = [];
      }
    }

    receiptLines = receiptLines
      .filter((l) => l && typeof l.name === 'string' && l.name.trim() && !Number.isNaN(Number(l.price)))
      .map((l) => ({ name: l.name.trim(), price: Number(l.price) }));

    if (receiptLines.length === 0) {
      res.status(200).json({ matches: [], extras: [] });
      return;
    }

    // No list to match against — everything is an extra by definition.
    if (knownItems.length === 0) {
      res.status(200).json({ matches: [], extras: receiptLines });
      return;
    }

    // ---- Step 2: Match only (text-only, no image — cheaper + faster than re-sending the photo). ----
    const matchPrompt = `You are matching grocery receipt line items to a shopper's existing "To Buy" list.
The shopper's list may be in English, Malay, or local dialect, and may be abbreviated on the
receipt (e.g. "AYAM SEGAR/KG" on a receipt could mean "Ayam" on the list). Use your knowledge of
Malaysian grocery naming/synonyms/cross-language equivalents to decide matches.

Shopper's To Buy list (id: name (qty needed)):
${knownItems.map((i) => `${i.id}: ${i.name} (qty needed: ${i.qty === null || i.qty === undefined ? 1 : i.qty})`).join('\n')}

Receipt line items:
${receiptLines.map((l, idx) => `${idx}: ${l.name} (RM${l.price})`).join('\n')}

Rules:
- Each receipt line should match AT MOST ONE list item.
- A list item CAN be matched by MORE THAN ONE receipt line if, and only if, its "qty needed" is
  greater than 1 — e.g. a list item like "Ayam" with qty needed 2 (because it was requested by
  two different family members and combined into one list entry) can legitimately correspond to
  TWO separate receipt lines (e.g. two separately-weighed chicken purchases). Never match more
  receipt lines to a list item than its stated "qty needed".
- If a receipt line clearly corresponds to a list item, set "matchedItemId" to that item's id.
- If a receipt line has no reasonable corresponding list item, or the list item's qty needed is
  already fully accounted for by other receipt lines, set "matchedItemId" to null.
- Prefer confident matches over guessing — when genuinely ambiguous between two list items, return null
  rather than picking incorrectly.
- Return one output object per receipt line, in the same order as the receipt line items above,
  each with "receiptName" (the receipt line's name, verbatim), "price" (the receipt line's price,
  verbatim), and "matchedItemId".
Output ONLY a JSON array, no markdown, no commentary.`;

    const matchResponse = await callGemini('gemini-3.1-flash-lite', {
      contents: [{ parts: [{ text: matchPrompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: matchSchema }
    }, 13000);

    if (!matchResponse.ok) {
      const errText = await matchResponse.text().catch(() => '');
      res.status(502).json({ error: `Gemini match error (${matchResponse.status}): ${errText.slice(0, 300)}` });
      return;
    }

    const matchData = await matchResponse.json();
    const matchRaw = matchData?.candidates?.[0]?.content?.parts?.[0]?.text;

    let matchResults = [];
    if (matchRaw) {
      try {
        const parsed = safeJsonParse(matchRaw);
        if (Array.isArray(parsed)) matchResults = parsed;
      } catch (e) {
        matchResults = [];
      }
    }

    // Fallback: if the match call produced nothing usable, treat every OCR'd line as an extra
    // rather than silently dropping the whole scan.
    if (matchResults.length === 0) {
      res.status(200).json({ matches: [], extras: receiptLines });
      return;
    }

    const knownIds = new Set(knownItems.map((i) => i.id));

    // Phase 11 — server-side dedup safety net, upgraded from a one-shot Set to a per-item
    // counter. A list item's merged qty (e.g. "Ayam" qty 2, combined from two people's
    // requests) can legitimately be fulfilled by more than one receipt line, so the cap is now
    // the item's own qty (floored, minimum 1) instead of a flat 1-per-item limit.
    const capById = new Map(knownItems.map((i) => {
      const qtyNum = Number(i.qty);
      const cap = (!Number.isNaN(qtyNum) && qtyNum > 0) ? Math.max(1, Math.floor(qtyNum)) : 1;
      return [i.id, cap];
    }));
    const usedCounts = new Map();

    const matches = [];
    const extras = [];

    matchResults.forEach((r) => {
      const receiptName = typeof r.receiptName === 'string' ? r.receiptName.trim() : '';
      const price = Number(r.price);
      if (!receiptName || Number.isNaN(price)) return;

      const claimedId = typeof r.matchedItemId === 'string' ? r.matchedItemId : null;
      const cap = claimedId ? (capById.get(claimedId) || 1) : 0;
      const used = claimedId ? (usedCounts.get(claimedId) || 0) : 0;

      if (claimedId && knownIds.has(claimedId) && used < cap) {
        usedCounts.set(claimedId, used + 1);
        matches.push({ itemId: claimedId, price, receiptName });
      } else {
        extras.push({ name: receiptName, price });
      }
    });

    res.status(200).json({ matches, extras });
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Gemini took too long to read the receipt (timeout)' });
      return;
    }
    if (err.name === 'NoKeyError') {
      res.status(500).json({ error: err.message });
      return;
    }
    res.status(502).json({ error: 'Could not reach Gemini' });
  }
};
