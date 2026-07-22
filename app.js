// SmartTroli (KongsiTroli) — app.js
// Phase 1+2: shared-expense engine + Gemini-powered scratchpad parsing.
// Items are captured QTY-FIRST (name + quantity), price is optional and filled in
// at the shelf/checkout — this matches how real chaotic family lists actually start.

const ITEMS_KEY = 'smarttroli_items_v4';
const PEOPLE_KEY = 'smarttroli_people_v2';
const ADJ_KEY = 'smarttroli_adjustments_v2';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = (n) => `RM ${(Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)}`;

// qty is nullable: null means "quantity not yet known" (shows an Add Qty button in the UI)
// instead of silently defaulting to 1 — this matters for chaotic pre-shopping lists where
// half the items have no stated quantity at all (e.g. "KICAP", "PISANG").
function normalizeQty(q) {
  if (q === null || q === undefined || q === '') return null;
  const n = parseFloat(q);
  return (isNaN(n) || n <= 0) ? null : n;
}

// ---------- STATE ----------
const State = {
  items: [],       // { id, name, qty (number|null), unit, price, category, inTrolley, owner,
                   //   paymentMode, scanned } — scanned=true means a receipt confirmed this
                   //   item as bought (Phase 5: To Buy / Bought tabs). Items loaded from an
                   //   older localStorage version won't have this field; treated as falsy
                   //   (i.e. still "to buy") everywhere it's read, so no migration needed.
  people: [],      // { id, name, isMe, cashAdvance, shareWeight } — shareWeight is Phase 10
                   //   step 4's custom shared-split ratio (default 1 = equal share). Older
                   //   localStorage records won't have this field; personWeight() below
                   //   treats a missing/invalid value as 1, so no migration needed.
  adjustments: { discount: 0, rounding: 0 },

  load() {
    try { this.items = JSON.parse(localStorage.getItem(ITEMS_KEY)) || []; } catch (e) { this.items = []; }
    try { this.people = JSON.parse(localStorage.getItem(PEOPLE_KEY)) || null; } catch (e) { this.people = null; }
    if (!this.people || this.people.length === 0) {
      this.people = [{ id: 'me', name: 'Me', isMe: true, cashAdvance: 0, shareWeight: 1 }];
    }
    try { this.adjustments = JSON.parse(localStorage.getItem(ADJ_KEY)) || { discount: 0, rounding: 0 }; } catch (e) { this.adjustments = { discount: 0, rounding: 0 }; }
  },
  saveItems() { localStorage.setItem(ITEMS_KEY, JSON.stringify(this.items)); },
  savePeople() { localStorage.setItem(PEOPLE_KEY, JSON.stringify(this.people)); },
  saveAdj() { localStorage.setItem(ADJ_KEY, JSON.stringify(this.adjustments)); },

  addItem(name, price = 0, owner = 'me', paymentMode = 'cash', qty = 1, unit = '', category = '', scanned = false) {
    this.items.push({
      id: uid(),
      name: name.trim(),
      qty: normalizeQty(qty),
      unit: (unit || '').trim(),
      price: parseFloat(price) || 0,
      category: (category || '').trim(),
      inTrolley: false,
      owner,
      paymentMode,
      scanned: !!scanned
    });
    this.saveItems();
  },
  toggleItem(id) { const i = this.items.find(x => x.id === id); if (i) { i.inTrolley = !i.inTrolley; this.saveItems(); } },
  removeItem(id) { this.items = this.items.filter(x => x.id !== id); this.saveItems(); },
  updateItem(id, patch) { const i = this.items.find(x => x.id === id); if (i) { Object.assign(i, patch); this.saveItems(); } },
  clearAll() { this.items = []; this.saveItems(); },

  // Find a person by case-insensitive name, or create one if it doesn't exist yet
  // (used when Gemini/local-parser detects a salutation like "Abah :" in the scratchpad).
  findOrCreatePerson(name) {
    if (!name) return 'me';
    const trimmed = name.trim();
    if (!trimmed || trimmed.toLowerCase() === 'me' || trimmed.toLowerCase() === 'saya') return 'me';
    const existing = this.people.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    const newPerson = { id: uid(), name: trimmed, isMe: false, cashAdvance: 0, shareWeight: 1 };
    this.people.push(newPerson);
    this.savePeople();
    return newPerson.id;
  },

  addPerson(name, cashAdvance, shareWeight = 1) {
    const w = parseFloat(shareWeight);
    this.people.push({ id: uid(), name: name.trim(), isMe: false, cashAdvance: parseFloat(cashAdvance) || 0, shareWeight: (!isNaN(w) && w >= 0) ? w : 1 });
    this.savePeople();
  },
  updatePerson(id, patch) {
    const p = this.people.find(x => x.id === id);
    if (p) { Object.assign(p, patch); this.savePeople(); }
  },
  removePerson(id) {
    if (id === 'me') return;
    this.people = this.people.filter(p => p.id !== id);
    // reassign orphaned items back to Me
    this.items.forEach(i => { if (i.owner === id) i.owner = 'me'; });
    this.savePeople(); this.saveItems();
  },

  // Phase 10 step 4 — custom shared-split ratios. A person's weight determines what fraction
  // of Shared (Kongsi) items they carry, relative to everyone else's weight (default 1 each
  // = the old even split). Missing/zero/invalid weight (e.g. records saved before this field
  // existed) falls back to 1 rather than breaking the split.
  personWeight(person) {
    const w = person ? parseFloat(person.shareWeight) : NaN;
    return (!isNaN(w) && w >= 0) ? w : 1;
  },
  totalWeight() {
    const sum = this.people.reduce((s, p) => s + this.personWeight(p), 0);
    return sum > 0 ? sum : this.people.length; // guard against every weight being 0
  },

  estimatedTotal() { return this.items.reduce((s, i) => s + i.price, 0); },
  trolleyTotal() { return this.items.filter(i => i.inTrolley).reduce((s, i) => s + i.price, 0); },

  cashInHand() {
    const totalAdvance = this.people.reduce((s, p) => s + (p.cashAdvance || 0), 0);
    const cashSpent = this.items.reduce((s, i) => s + (i.paymentMode === 'cash' ? i.price : 0), 0);
    return totalAdvance - cashSpent + this.adjustments.rounding - this.adjustments.discount;
  },
  digitalSpent() {
    return this.items.filter(i => i.paymentMode === 'digital').reduce((s, i) => s + i.price, 0);
  },

  // Settlement Engine ("Arahan Malas")
  settlement() {
    const totalWeight = this.totalWeight();
    const sharedItems = this.items.filter(i => i.owner === 'shared');
    const sharedCashTotal = sharedItems.filter(i => i.paymentMode === 'cash').reduce((s, i) => s + i.price, 0);
    const sharedDigitalTotal = sharedItems.filter(i => i.paymentMode === 'digital').reduce((s, i) => s + i.price, 0);
    const sharedGrandTotal = sharedItems.reduce((s, i) => s + i.price, 0);

    const results = [];
    this.people.filter(p => !p.isMe).forEach(person => {
      const shareFraction = this.personWeight(person) / totalWeight;
      const ownItems = this.items.filter(i => i.owner === person.id);
      const cashPortion = ownItems.filter(i => i.paymentMode === 'cash').reduce((s, i) => s + i.price, 0) + (sharedCashTotal * shareFraction);
      const digitalPortion = ownItems.filter(i => i.paymentMode === 'digital').reduce((s, i) => s + i.price, 0) + (sharedDigitalTotal * shareFraction);

      let cashRemaining = (person.cashAdvance || 0) - cashPortion;
      let digitalOwed = digitalPortion;
      const lines = [];

      if (cashRemaining > 0 && digitalOwed > 0) {
        const offset = Math.min(cashRemaining, digitalOwed);
        cashRemaining -= offset;
        digitalOwed -= offset;
        if (offset > 0.005) lines.push(`Keep ${fmt(offset)} cash to offset the QR/bank payment you advanced`);
      }
      if (cashRemaining > 0.005) lines.push(`Return ${fmt(cashRemaining)} cash to ${person.name}`);
      if (cashRemaining < -0.005) lines.push(`Collect ${fmt(-cashRemaining)} more cash from ${person.name}`);
      if (digitalOwed > 0.005) lines.push(`Collect ${fmt(digitalOwed)} via bank/QR from ${person.name}`);
      if (lines.length === 0) lines.push(`Fully settled with ${person.name} — nothing owed either way`);

      results.push({ person: person.name, total: ownItems.reduce((s, i) => s + i.price, 0) + (sharedGrandTotal * shareFraction), lines });
    });

    return results;
  }
};

// ---------- DOM refs ----------
const el = {
  form: document.getElementById('addForm'),
  name: document.getElementById('itemName'),
  price: document.getElementById('itemPrice'),
  qty: document.getElementById('itemQty'),
  unit: document.getElementById('itemUnit'),
  ownerSelect: document.getElementById('ownerSelect'),
  payToggle: document.getElementById('payToggle'),
  list: document.getElementById('itemList'),
  empty: document.getElementById('emptyState'),
  estTotal: document.getElementById('estTotal'),
  troliTotal: document.getElementById('troliTotal'),
  itemCount: document.getElementById('itemCount'),
  tabToBuyBtn: document.getElementById('tabToBuyBtn'),
  tabBoughtBtn: document.getElementById('tabBoughtBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  cashInHand: document.getElementById('cashInHand'),
  digitalOwed: document.getElementById('digitalOwed'),
  peopleChips: document.getElementById('peopleChips'),
  addPersonBtn: document.getElementById('addPersonBtn'),
  settleBtn: document.getElementById('settleBtn'),
  addFab: document.getElementById('addFab'),
  addSheet: document.getElementById('addSheet'),
  addSheetCloseBtn: document.getElementById('addSheetCloseBtn'),
  modeStructuredBtn: document.getElementById('modeStructuredBtn'),
  modeScratchBtn: document.getElementById('modeScratchBtn'),
  scratchWrap: document.getElementById('scratchWrap'),
  scratchInputWrap: document.getElementById('scratchInputWrap'),
  scratchText: document.getElementById('scratchText'),
  scratchParseBtn: document.getElementById('scratchParseBtn'),
  scratchSkeleton: document.getElementById('scratchSkeleton'),
  scratchError: document.getElementById('scratchError'),
  scratchPreviewWrap: document.getElementById('scratchPreviewWrap'),
  scratchPreviewList: document.getElementById('scratchPreviewList'),
  scratchPreviewCount: document.getElementById('scratchPreviewCount'),
  scratchBackBtn: document.getElementById('scratchBackBtn'),
  scratchConfirmBtn: document.getElementById('scratchConfirmBtn'),
  structuredForm: document.getElementById('structuredFormWrap'),
  scanReceiptBtn: document.getElementById('scanReceiptBtn'),
  receiptFileInput: document.getElementById('receiptFileInput'),
  receiptUploadInput: document.getElementById('receiptUploadInput'),
  receiptSourceSheet: document.getElementById('receiptSourceSheet'),
  receiptSourceCameraBtn: document.getElementById('receiptSourceCameraBtn'),
  receiptSourceGalleryBtn: document.getElementById('receiptSourceGalleryBtn'),
  receiptSourceCancelBtn: document.getElementById('receiptSourceCancelBtn'),
  receiptSourceLocalToggle: document.getElementById('receiptSourceLocalToggle'),
  receiptSourceLocalToggleDot: document.getElementById('receiptSourceLocalToggleDot'),
  receiptScanningOverlay: document.getElementById('receiptScanningOverlay'),
  receiptScanningLabel: document.getElementById('receiptScanningLabel'),
  receiptModal: document.getElementById('receiptModal'),
  receiptBody: document.getElementById('receiptBody'),
  receiptCloseBtn: document.getElementById('receiptCloseBtn'),
  // modals
  personModal: document.getElementById('personModal'),
  personModalTitle: document.getElementById('personModalTitle'),
  personName: document.getElementById('personName'),
  personCash: document.getElementById('personCash'),
  personShareWeight: document.getElementById('personShareWeight'),
  personSaveBtn: document.getElementById('personSaveBtn'),
  personCancelBtn: document.getElementById('personCancelBtn'),
  settleModal: document.getElementById('settleModal'),
  settleBody: document.getElementById('settleBody'),
  settleCloseBtn: document.getElementById('settleCloseBtn'),
  editModal: document.getElementById('editModal'),
  editName: document.getElementById('editName'),
  editQty: document.getElementById('editQty'),
  editUnit: document.getElementById('editUnit'),
  editPrice: document.getElementById('editPrice'),
  editOwnerSelect: document.getElementById('editOwnerSelect'),
  editPayToggle: document.getElementById('editPayToggle'),
  editSaveBtn: document.getElementById('editSaveBtn'),
  editCancelBtn: document.getElementById('editCancelBtn'),
  markBoughtModal: document.getElementById('markBoughtModal'),
  markBoughtTitle: document.getElementById('markBoughtTitle'),
  markBoughtPrice: document.getElementById('markBoughtPrice'),
  markBoughtSaveBtn: document.getElementById('markBoughtSaveBtn'),
  markBoughtCancelBtn: document.getElementById('markBoughtCancelBtn'),
  adjustBtn: document.getElementById('adjustBtn'),
  adjustModal: document.getElementById('adjustModal'),
  adjustDiscount: document.getElementById('adjustDiscount'),
  adjustRounding: document.getElementById('adjustRounding'),
  adjustSaveBtn: document.getElementById('adjustSaveBtn'),
  adjustCancelBtn: document.getElementById('adjustCancelBtn'),
  geminiDot: document.getElementById('geminiDot'),
  geminiCheckBtn: document.getElementById('geminiCheckBtn'),
  toastEl: document.getElementById('appToast'),
  toastMsg: document.getElementById('appToastMsg')
};

let toastTimer = null;
function toast(message, tone = 'info') {
  el.toastMsg.textContent = message;
  el.toastEl.classList.remove('hidden', 'bg-troli-ink', 'bg-troli-orange', 'bg-troli-green');
  el.toastEl.classList.add(tone === 'error' ? 'bg-troli-orange' : tone === 'success' ? 'bg-troli-green' : 'bg-troli-ink');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toastEl.classList.add('hidden'), 3800);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function personName(id) {
  const p = State.people.find(x => x.id === id);
  return p ? p.name : 'Me';
}

function renderOwnerOptions(selectEl, selectedId) {
  selectEl.innerHTML = '';
  State.people.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });
  const sharedOpt = document.createElement('option');
  sharedOpt.value = 'shared'; sharedOpt.textContent = 'Shared (Kongsi)';
  if (selectedId === 'shared') sharedOpt.selected = true;
  selectEl.appendChild(sharedOpt);
}

function renderPeopleChips() {
  el.peopleChips.innerHTML = '';
  State.people.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'flex items-center gap-1 bg-troli-card dark:bg-troli-carddark border border-troli-rail dark:border-troli-raildark rounded-full pl-1 pr-2 py-1 text-xs shrink-0';

    // Phase 10 step 4: everyone (including "Me") is tappable now, since "Me" also needs a way
    // to set a custom share ratio even though cash advance doesn't apply to them.
    const weight = State.personWeight(p);
    const weightBadge = weight !== 1 ? ` · ${weight}x` : '';
    const tapTarget = document.createElement('button');
    tapTarget.type = 'button';
    tapTarget.className = 'flex items-center gap-1 px-2 py-0.5 rounded-full active:scale-95 transition-transform';
    tapTarget.innerHTML = `<span class="font-medium">${escapeHtml(p.name)}</span><span class="text-troli-sub dark:text-troli-subdark">${!p.isMe ? `· ${fmt(p.cashAdvance || 0)}` : ''}${weightBadge}</span>`;
    tapTarget.addEventListener('click', () => openPersonModal(p));
    chip.appendChild(tapTarget);

    if (!p.isMe) {
      const x = document.createElement('button');
      x.textContent = '✕';
      x.className = 'ml-1 text-troli-sub dark:text-troli-subdark shrink-0';
      x.addEventListener('click', () => { State.removePerson(p.id); renderAll(); });
      chip.appendChild(x);
    }
    el.peopleChips.appendChild(chip);
  });
}

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'relative overflow-hidden rounded-2xl border border-troli-rail dark:border-troli-raildark';
  li.dataset.id = item.id;

  const hasQty = item.qty !== null && item.qty !== undefined;
  const qtyDisplay = hasQty ? `${item.qty}${item.unit ? ' ' + escapeHtml(item.unit) : ''}` : null;
  const priceText = item.price > 0 ? fmt(item.price) : 'Price TBD';

  // Once a receipt confirms an item as bought (item.scanned), qty stops being the useful
  // number to show — the shopper isn't picking a quantity off a shelf anymore, they're
  // reviewing what they paid. So the trailing badge flips from qty to price, and the price
  // that used to live in the subtitle moves out to make room for qty there instead (keeps
  // "how many did I actually buy" visible without needing to reopen Edit).
  const subtitleTail = item.scanned
    ? (hasQty ? escapeHtml(qtyDisplay) : '')
    : (item.price > 0 ? escapeHtml(priceText) : '<span class="italic">Price TBD</span>');
  const subtitleParts = [
    item.owner === 'shared' ? 'Shared (Kongsi)' : escapeHtml(personName(item.owner)),
    item.paymentMode === 'digital' ? 'Digital/QR' : 'Cash'
  ];
  if (subtitleTail) subtitleParts.push(subtitleTail);

  const trailingHtml = item.scanned
    ? `<span class="strike-anim text-sm font-display font-semibold shrink-0 ${item.inTrolley ? 'line-through opacity-50' : ''}">${escapeHtml(priceText)}</span>`
    : (hasQty
        ? `<span class="strike-anim text-sm font-display font-semibold shrink-0 ${item.inTrolley ? 'line-through opacity-50' : ''}">${qtyDisplay}</span>`
        : `<button class="addQtyBtn text-xs font-semibold text-troli-orange border border-troli-orange/50 rounded-full px-3 py-1.5 shrink-0 active:scale-95 transition-transform">+ Add Qty</button>`);

  li.innerHTML = `
    <div class="editRow absolute inset-0 flex items-center justify-end gap-2 px-3 bg-troli-orange/90">
      ${item.scanned
        ? '<button class="undoBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/20 rounded-full">↩ Undo</button>'
        : '<button class="markBoughtBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/20 rounded-full">✓ Bought</button>'}
      <button class="editBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/20 rounded-full">Edit</button>
      <button class="delBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/30 rounded-full">Delete</button>
    </div>
    <div class="swipeRow bg-troli-card dark:bg-troli-carddark px-4 py-3 flex items-center gap-3 relative" style="transform: translateX(0px); transition: transform .18s ease;">
      <input type="checkbox" class="troli-check" ${item.inTrolley ? 'checked' : ''}>
      <div class="flex-1 min-w-0">
        <p class="strike-anim text-sm font-medium truncate ${item.inTrolley ? 'line-through decoration-troli-green dark:decoration-troli-greenlight opacity-50' : ''}">${escapeHtml(item.name)}</p>
        <p class="text-[11px] text-troli-sub dark:text-troli-subdark truncate">${subtitleParts.join(' · ')}</p>
      </div>
      ${trailingHtml}
    </div>
  `;

  const swipeRow = li.querySelector('.swipeRow');
  li.querySelector('.troli-check').addEventListener('change', () => { State.toggleItem(item.id); renderAll(); });
  li.querySelector('.delBtn').addEventListener('click', () => { State.removeItem(item.id); renderAll(); });
  li.querySelector('.editBtn').addEventListener('click', () => openEditModal(item));
  const addQtyBtn = li.querySelector('.addQtyBtn');
  if (addQtyBtn) addQtyBtn.addEventListener('click', () => openEditModal(item, 'qty'));
  const undoBtn = li.querySelector('.undoBtn');
  if (undoBtn) undoBtn.addEventListener('click', () => {
    // Phase 10 step 1 — sends a mis-scanned/incorrectly-matched Bought item back to To Buy.
    // Only the receipt-derived state (scanned + inTrolley) is reset — name/price/qty/owner
    // are left as-is, since that data is still valid and the user may want to keep or edit it
    // from the To Buy tab (e.g. via the normal Edit action) rather than losing it outright.
    State.updateItem(item.id, { scanned: false, inTrolley: false });
    renderAll();
    toast(`${item.name} sent back to To Buy`, 'info');
  });
  const markBoughtBtn = li.querySelector('.markBoughtBtn');
  if (markBoughtBtn) markBoughtBtn.addEventListener('click', () => openMarkBoughtModal(item));

  // Swipe gestures
  let startX = 0, currentX = 0, dragging = false;
  swipeRow.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; dragging = true; }, { passive: true });
  swipeRow.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    currentX = e.touches[0].clientX - startX;
    const clamped = Math.max(-90, Math.min(90, currentX));
    swipeRow.style.transform = `translateX(${clamped}px)`;
  }, { passive: true });
  swipeRow.addEventListener('touchend', () => {
    dragging = false;
    if (currentX > 60) { State.toggleItem(item.id); renderAll(); return; }
    if (currentX < -60) { swipeRow.style.transform = 'translateX(-84px)'; }
    else { swipeRow.style.transform = 'translateX(0px)'; }
    currentX = 0;
  });

  return li;
}

let editingId = null;

function openEditModal(item, focusField) {
  editingId = item.id;
  el.editName.value = item.name;
  el.editQty.value = (item.qty === null || item.qty === undefined) ? '' : item.qty;
  el.editUnit.value = item.unit || '';
  el.editPrice.value = item.price || 0;
  renderOwnerOptions(el.editOwnerSelect, item.owner);
  el.editPayToggle.dataset.mode = item.paymentMode;
  el.editPayToggle.textContent = item.paymentMode === 'digital' ? '📱 Digital' : '💵 Cash';
  el.editModal.classList.remove('hidden');
  if (focusField === 'qty') { setTimeout(() => el.editQty.focus(), 50); }
}

el.editPayToggle.addEventListener('click', () => {
  const isDigital = el.editPayToggle.dataset.mode === 'digital';
  el.editPayToggle.dataset.mode = isDigital ? 'cash' : 'digital';
  el.editPayToggle.textContent = isDigital ? '💵 Cash' : '📱 Digital';
});

el.editCancelBtn.addEventListener('click', () => { editingId = null; el.editModal.classList.add('hidden'); });

el.editSaveBtn.addEventListener('click', () => {
  if (!editingId) return;
  const name = el.editName.value.trim();
  if (!name) { toast('Item name cannot be empty', 'error'); return; }
  State.updateItem(editingId, {
    name,
    qty: normalizeQty(el.editQty.value),
    unit: el.editUnit.value.trim(),
    price: parseFloat(el.editPrice.value) || 0,
    owner: el.editOwnerSelect.value,
    paymentMode: el.editPayToggle.dataset.mode
  });
  editingId = null;
  el.editModal.classList.add('hidden');
  renderAll();
});

// ---------- Phase 11 — manual "Mark as Bought" ----------
// Not every purchase produces a receipt (pasar malam / wet-market stalls, informal cash buys,
// etc). Previously the ONLY way an item moved from To Buy to Bought was via a receipt scan
// match. This lets the user manually confirm a To Buy item was bought and record its price,
// without needing a receipt at all.
let markBoughtId = null;

function openMarkBoughtModal(item) {
  markBoughtId = item.id;
  el.markBoughtTitle.textContent = `Mark "${item.name}" as Bought`;
  el.markBoughtPrice.value = item.price > 0 ? item.price : '';
  el.markBoughtModal.classList.remove('hidden');
  setTimeout(() => el.markBoughtPrice.focus(), 50);
}

el.markBoughtCancelBtn.addEventListener('click', () => {
  markBoughtId = null;
  el.markBoughtModal.classList.add('hidden');
});

el.markBoughtSaveBtn.addEventListener('click', () => {
  if (!markBoughtId) return;
  const price = parseFloat(el.markBoughtPrice.value) || 0;
  const item = State.items.find(i => i.id === markBoughtId);
  State.updateItem(markBoughtId, { price, scanned: true, inTrolley: true });
  markBoughtId = null;
  el.markBoughtModal.classList.add('hidden');
  renderAll();
  toast(item ? `${item.name} marked as Bought` : 'Marked as Bought', 'success');
});

const CATEGORY_ORDER = ['Sayur-sayuran', 'Buah-buahan', 'Daging & Ayam', 'Ikan & Makanan Laut', 'Tenusu', 'Perencah & Sos', 'Lain-lain'];

// Fixed per-category accent colors (not cycled by render order) so a category keeps the same
// color across renders — makes the categorized list visually varied instead of monotone green.
const CATEGORY_COLORS = {
  'Sayur-sayuran': '#34D399',      // emerald
  'Buah-buahan': '#F5B942',        // amber
  'Daging & Ayam': '#E8641F',      // orange
  'Ikan & Makanan Laut': '#5EB4E8', // sky
  'Tenusu': '#C084FC',             // violet
  'Perencah & Sos': '#FB923C',     // tangerine
  'Lain-lain': '#9FB0A6'           // neutral sub
};
function categoryColor(cat) { return CATEGORY_COLORS[cat] || '#9FB0A6'; }

function sortedCategories(categories) {
  return categories.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

// currentTab drives which half of the list is shown: 'tobuy' = !item.scanned,
// 'bought' = item.scanned. See CLAUDE_STATE.md "To Buy / Bought tabs" for the full rationale.
let currentTab = 'tobuy';

function tabItems() {
  return currentTab === 'bought' ? State.items.filter(i => i.scanned) : State.items.filter(i => !i.scanned);
}

function setActiveTab(tab) {
  currentTab = tab;
  const isToBuy = tab === 'tobuy';
  el.tabToBuyBtn.className = isToBuy
    ? 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-green dark:border-troli-greenlight troli-btn-primary'
    : 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-rail dark:border-troli-raildark bg-troli-card dark:bg-troli-carddark';
  el.tabBoughtBtn.className = !isToBuy
    ? 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-green dark:border-troli-greenlight troli-btn-primary'
    : 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-rail dark:border-troli-raildark bg-troli-card dark:bg-troli-carddark';
  // Adding new items only makes sense while you're still shopping — the Bought tab is a
  // record of what a receipt already confirmed, not a place to stage more items.
  el.addFab.classList.toggle('hidden', !isToBuy);
  renderAll();
}
el.tabToBuyBtn.addEventListener('click', () => setActiveTab('tobuy'));
el.tabBoughtBtn.addEventListener('click', () => setActiveTab('bought'));

function renderAll() {
  el.list.innerHTML = '';
  const items = tabItems();

  if (items.length === 0) {
    el.empty.classList.remove('hidden');
    const emptyParas = el.empty.querySelectorAll('p');
    if (currentTab === 'bought') {
      emptyParas[0].innerHTML = 'Nothing bought yet.<br>Scan a receipt to move items here once they\'re purchased.';
      emptyParas[1].classList.add('hidden');
    } else {
      emptyParas[0].innerHTML = 'Your trolley is empty.<br>Tap the + button to add your first item!';
      emptyParas[1].classList.remove('hidden');
    }
  } else {
    el.empty.classList.add('hidden');

    const groups = {};
    items.forEach(i => {
      const cat = i.category || 'Lain-lain';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(i);
    });
    const categoryNames = Object.keys(groups);

    // Manually checking an item off (before it's ever gone through a receipt scan) sinks it
    // to the bottom of its category within To Buy, so the top of the list always shows what's
    // still outstanding. Stable sort preserves add-order otherwise. Bought tab intentionally
    // has no special sort — just whatever order items landed in as they got scanned/added.
    if (currentTab === 'tobuy') {
      categoryNames.forEach(cat => {
        groups[cat].sort((a, b) => (a.inTrolley === b.inTrolley ? 0 : a.inTrolley ? 1 : -1));
      });
    }

    if (categoryNames.length <= 1) {
      // Flat list — no point showing a single category header.
      (groups[categoryNames[0]] || []).forEach(i => el.list.appendChild(renderItem(i)));
    } else {
      sortedCategories(categoryNames).forEach(cat => {
        const color = categoryColor(cat);
        const header = document.createElement('li');
        header.className = 'sticky top-0 z-10 bg-troli-bg/95 dark:bg-troli-bgdark/95 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-wider px-1 py-1.5 -mx-2 -mt-2 flex items-center gap-1.5';
        header.style.color = color;
        header.innerHTML = `<span class="inline-block w-2 h-2 rounded-full" style="background:${color}"></span>${escapeHtml(cat)}`;
        el.list.appendChild(header);
        groups[cat].forEach(i => el.list.appendChild(renderItem(i)));
      });
    }
  }

  el.estTotal.textContent = fmt(State.estimatedTotal());
  el.troliTotal.textContent = fmt(State.trolleyTotal());
  el.itemCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  el.cashInHand.textContent = fmt(State.cashInHand());
  el.digitalOwed.textContent = fmt(State.digitalSpent());

  renderPeopleChips();
  renderOwnerOptions(el.ownerSelect, el.ownerSelect.value || 'me');
}

// ---------- Add item form ----------
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el.name.value.trim();
  if (!name) return;
  const price = el.price.value === '' ? 0 : el.price.value;
  const qty = el.qty && el.qty.value !== '' ? el.qty.value : 1;
  const unit = el.unit ? el.unit.value.trim() : '';
  State.addItem(name, price, el.ownerSelect.value, el.payToggle.dataset.mode, qty, unit);
  el.name.value = ''; el.price.value = ''; if (el.qty) el.qty.value = 1; if (el.unit) el.unit.value = '';
  el.name.focus();
  renderAll();
});

el.payToggle.addEventListener('click', () => {
  const isDigital = el.payToggle.dataset.mode === 'digital';
  el.payToggle.dataset.mode = isDigital ? 'cash' : 'digital';
  el.payToggle.textContent = isDigital ? '💵 Cash' : '📱 Digital';
});

el.clearAllBtn.addEventListener('click', () => {
  if (State.items.length === 0) return;
  if (confirm('Clear the entire list? This cannot be undone.')) { State.clearAll(); renderAll(); toast('List cleared', 'info'); }
});

// ---------- Adjustments (discount / rounding) modal ----------
el.adjustBtn.addEventListener('click', () => {
  el.adjustDiscount.value = State.adjustments.discount || 0;
  el.adjustRounding.value = State.adjustments.rounding || 0;
  el.adjustModal.classList.remove('hidden');
});
el.adjustCancelBtn.addEventListener('click', () => el.adjustModal.classList.add('hidden'));
el.adjustSaveBtn.addEventListener('click', () => {
  State.adjustments = {
    discount: parseFloat(el.adjustDiscount.value) || 0,
    rounding: parseFloat(el.adjustRounding.value) || 0
  };
  State.saveAdj();
  el.adjustModal.classList.add('hidden');
  renderAll();
  toast('Adjustments saved', 'success');
});

// ---------- Gemini connection check ----------
async function checkGeminiConnection(silent = false) {
  el.geminiDot.className = 'inline-block w-2 h-2 rounded-full bg-troli-sub dark:bg-troli-subdark animate-pulse';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (res.ok && data.ok) {
      el.geminiDot.className = 'inline-block w-2 h-2 rounded-full bg-troli-green dark:bg-troli-greenlight';
      if (!silent) toast('Gemini connection OK ✅', 'success');
    } else {
      el.geminiDot.className = 'inline-block w-2 h-2 rounded-full bg-troli-orange';
      if (!silent) toast(data.message || 'Gemini connection failed', 'error');
    }
  } catch (err) {
    el.geminiDot.className = 'inline-block w-2 h-2 rounded-full bg-troli-orange';
    if (!silent) toast('Could not reach Gemini (offline or server error)', 'error');
  }
}
el.geminiCheckBtn.addEventListener('click', () => checkGeminiConnection(false));

// ---------- People modal (add + edit — Phase 2.15; share ratio — Phase 10 step 4) ----------
// editingPersonId tracks whether the modal is creating a new person (null) or editing an
// existing one's name/cashAdvance/shareWeight (their id) — previously there was no edit path
// at all, so a mistyped or later-updated cash advance (e.g. an auto-created "Abah" from the
// scratchpad, which always starts at RM 0.00) could never be corrected without deleting and
// re-adding them.
let editingPersonId = null;

// Phase 10 step 2 — cash-advance nudge queue. Holds personIds that were just auto-created
// from a scratchpad salutation header (e.g. "Abah :") and still sit at the default
// cashAdvance: 0 with no prompt to ever set one (Known Gap #3). Processed one at a time
// through the SAME person modal used for normal add/edit, so no new UI surface is needed.
let cashNudgeQueue = [];

function processCashNudgeQueue() {
  if (cashNudgeQueue.length === 0) return;
  const personId = cashNudgeQueue.shift();
  const person = State.people.find(p => p.id === personId);
  if (!person) { processCashNudgeQueue(); return; } // person was removed before its turn came up
  openPersonModal(person, true);
}

function openPersonModal(person, isNudge = false) {
  editingPersonId = person ? person.id : null;
  const isMe = !!(person && person.isMe);
  el.personModalTitle.textContent = isNudge
    ? `Set cash advance for ${person.name}?`
    : (person ? (isMe ? 'Your Share Ratio' : 'Edit Family Member') : 'Add Family Member');
  el.personName.value = person ? person.name : '';
  el.personName.disabled = isMe; // "Me"'s name is fixed
  el.personCash.value = person ? (person.cashAdvance || 0) : '';
  el.personCash.disabled = isMe; // cash advance doesn't apply to "Me"
  el.personShareWeight.value = person ? State.personWeight(person) : 1;
  el.personSaveBtn.textContent = person ? 'Save Changes' : 'Save';
  el.personModal.classList.remove('hidden');
}

el.addPersonBtn.addEventListener('click', () => openPersonModal(null));
el.personCancelBtn.addEventListener('click', () => {
  editingPersonId = null;
  el.personModal.classList.add('hidden');
  if (cashNudgeQueue.length) processCashNudgeQueue(); // skipping this nudge still advances to the next
});
el.personSaveBtn.addEventListener('click', () => {
  const rawWeight = parseFloat(el.personShareWeight.value);
  const shareWeight = (!isNaN(rawWeight) && rawWeight >= 0) ? rawWeight : 1;

  if (editingPersonId) {
    const existing = State.people.find(p => p.id === editingPersonId);
    if (existing && existing.isMe) {
      // "Me" only has a share ratio to edit here — name/cash advance fields are disabled.
      State.updatePerson(editingPersonId, { shareWeight });
    } else {
      const name = el.personName.value.trim();
      if (!name) return;
      State.updatePerson(editingPersonId, { name, cashAdvance: parseFloat(el.personCash.value) || 0, shareWeight });
    }
  } else {
    const name = el.personName.value.trim();
    if (!name) return;
    State.addPerson(name, el.personCash.value, shareWeight);
  }
  editingPersonId = null;
  el.personModal.classList.add('hidden');
  renderAll();
  if (cashNudgeQueue.length) processCashNudgeQueue();
});

// ---------- Settlement modal ----------
el.settleBtn.addEventListener('click', () => {
  const results = State.settlement();
  const hasCustomRatios = State.people.some(p => State.personWeight(p) !== 1);
  const ratioNote = hasCustomRatios
    ? `<p class="text-[11px] text-troli-green dark:text-troli-greenlight bg-troli-green/10 rounded-xl px-3 py-2 mb-3">⚖️ Shared (Kongsi) items are split by each person's custom ratio, not evenly. Tap a person chip to adjust.</p>`
    : '';
  if (results.length === 0) {
    el.settleBody.innerHTML = `${ratioNote}<p class="text-sm text-troli-sub dark:text-troli-subdark">Add a family member with a cash advance to see settlement instructions.</p>`;
  } else {
    el.settleBody.innerHTML = ratioNote + results.map(r => `
      <div class="mb-4 last:mb-0">
        <p class="text-sm font-semibold mb-1">${escapeHtml(r.person)} <span class="text-troli-sub dark:text-troli-subdark font-normal">· owes ${fmt(r.total)} total</span></p>
        <ul class="space-y-1">
          ${r.lines.map(l => `<li class="text-sm bg-troli-bg dark:bg-troli-bgdark rounded-xl px-3 py-2">${escapeHtml(l)}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }
  el.settleModal.classList.remove('hidden');
});
el.settleCloseBtn.addEventListener('click', () => el.settleModal.classList.add('hidden'));

// ---------- Dynamic Scratchpad (local naive parser — Gemini AI parsing is Phase 2) ----------
function openAddSheet() { resetScratchPreview(); el.addSheet.classList.remove('hidden'); }
function closeAddSheet() { el.addSheet.classList.add('hidden'); }

el.addFab.addEventListener('click', openAddSheet);
el.addSheetCloseBtn.addEventListener('click', closeAddSheet);
el.addSheet.addEventListener('click', (e) => { if (e.target === el.addSheet) closeAddSheet(); });

function setAddMode(mode) {
  const structured = mode === 'structured';
  el.structuredForm.classList.toggle('hidden', !structured);
  el.scratchWrap.classList.toggle('hidden', structured);
  el.modeStructuredBtn.dataset.active = structured;
  el.modeScratchBtn.dataset.active = !structured;
  el.modeStructuredBtn.className = structured
    ? 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-green dark:border-troli-greenlight troli-btn-primary'
    : 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-rail dark:border-troli-raildark bg-troli-card dark:bg-troli-carddark';
  el.modeScratchBtn.className = !structured
    ? 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-green dark:border-troli-greenlight troli-btn-primary'
    : 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-rail dark:border-troli-raildark bg-troli-card dark:bg-troli-carddark';
}
el.modeStructuredBtn.addEventListener('click', () => setAddMode('structured'));
el.modeScratchBtn.addEventListener('click', () => setAddMode('scratch'));

function setScratchLoading(isLoading) {
  el.scratchParseBtn.disabled = isLoading;
  el.scratchText.disabled = isLoading;
  el.scratchSkeleton.classList.toggle('hidden', !isLoading);
  el.scratchParseBtn.textContent = isLoading ? 'Parsing…' : 'Parse into list';
  if (isLoading) el.scratchError.classList.add('hidden');
}

function showScratchError(message) {
  el.scratchError.textContent = `⚠️ ${message}`;
  el.scratchError.classList.remove('hidden');
}

// Scratchpad is Gemini-only by design — no local fallback. If Gemini can't be reached,
// the user sees exactly why (offline / timeout / server error) instead of getting silently
// degraded results from a regex guesser. Structured mode remains fully offline-capable.
async function parseWithGemini(rawText) {
  if (!navigator.onLine) {
    const err = new Error('No internet connection. Gemini needs internet to parse your list.');
    err.reason = 'offline';
    throw err;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch('/api/parse-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (e) { /* ignore */ }
      const err = new Error(detail ? `Gemini API error: ${detail}` : `Gemini API error (${res.status}).`);
      err.reason = 'api';
      throw err;
    }

    const data = await res.json();
    if (!Array.isArray(data.items)) {
      const err = new Error('Gemini returned an unexpected response.');
      err.reason = 'api';
      throw err;
    }
    return data.items;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Gemini took too long to respond (timeout). Check your connection and try again.');
      timeoutErr.reason = 'timeout';
      throw timeoutErr;
    }
    if (!err.reason) {
      err.reason = 'network';
      err.message = 'Could not reach Gemini. Check your internet connection and try again.';
    }
    throw err;
  }
}

el.scratchParseBtn.addEventListener('click', async () => {
  const rawText = el.scratchText.value;
  if (!rawText.trim()) return;

  setScratchLoading(true);
  let parsed = [];

  try {
    parsed = await parseWithGemini(rawText);
  } catch (err) {
    setScratchLoading(false);
    showScratchError(err.message);
    checkGeminiConnection(true); // refresh the status dot to reflect the failure
    return;
  }

  setScratchLoading(false);

  if (!parsed || parsed.length === 0) {
    showScratchError('Gemini could not detect any items in that text.');
    return;
  }

  renderScratchPreview(parsed);
});

// ---------- Scratch review step (Gemini's extracted qty is editable before it hits the list) ----------
let pendingParsed = null;

function ownerLabelFor(ownerName) {
  if (ownerName && ownerName.trim().toLowerCase() === 'shared') return 'Shared (Kongsi)';
  if (ownerName) return ownerName;
  return 'Me';
}

function renderScratchPreview(items) {
  pendingParsed = items.map(p => ({ ...p })); // clone so the user can freely edit before committing
  el.scratchPreviewList.innerHTML = pendingParsed.map((p, idx) => `
    <div class="flex items-center gap-2 bg-troli-bg dark:bg-troli-bgdark rounded-xl px-3 py-2 border border-troli-rail dark:border-troli-raildark">
      <div class="flex-1 min-w-0">
        <p class="text-sm truncate">${escapeHtml(p.name)}</p>
        <p class="text-[10px] text-troli-sub dark:text-troli-subdark truncate">${escapeHtml(ownerLabelFor(p.ownerName))}${p.category ? ' · ' + escapeHtml(p.category) : ''}</p>
      </div>
      <input type="number" step="0.5" min="0" placeholder="Qty" value="${p.qty === null || p.qty === undefined ? '' : p.qty}"
        data-role="preview-qty" data-idx="${idx}"
        class="w-16 shrink-0 bg-troli-card dark:bg-troli-carddark rounded-lg px-2 py-1.5 text-sm text-center border border-troli-rail dark:border-troli-raildark outline-none focus:border-troli-green dark:focus:border-troli-greenlight" />
      <input type="text" placeholder="unit" value="${escapeHtml(p.unit || '')}"
        data-role="preview-unit" data-idx="${idx}" disabled title="Unit is set by Gemini and locked here — edit it later from Edit if needed."
        class="w-14 shrink-0 bg-troli-card dark:bg-troli-carddark rounded-lg px-1.5 py-1.5 text-[11px] text-center border border-troli-rail dark:border-troli-raildark outline-none opacity-50 cursor-not-allowed" />
    </div>
  `).join('');
  el.scratchPreviewCount.textContent = `${pendingParsed.length} item${pendingParsed.length === 1 ? '' : 's'} detected`;
  el.scratchInputWrap.classList.add('hidden');
  el.scratchPreviewWrap.classList.remove('hidden');
}

function resetScratchPreview() {
  pendingParsed = null;
  el.scratchPreviewList.innerHTML = '';
  el.scratchPreviewWrap.classList.add('hidden');
  el.scratchInputWrap.classList.remove('hidden');
}

el.scratchBackBtn.addEventListener('click', resetScratchPreview);

el.scratchConfirmBtn.addEventListener('click', () => {
  if (!pendingParsed || pendingParsed.length === 0) return;

  // Pull whatever the user last typed into each qty box — this is the whole point of the
  // review step, so read straight from the inputs rather than trusting Gemini's original
  // values. The unit input is disabled (Phase 11) so pendingParsed[idx].unit is left exactly
  // as Gemini produced it — intentional, no read-back needed for a disabled field.
  el.scratchPreviewList.querySelectorAll('[data-role="preview-qty"]').forEach(input => {
    const idx = parseInt(input.dataset.idx, 10);
    if (pendingParsed[idx]) pendingParsed[idx].qty = input.value === '' ? null : parseFloat(input.value);
  });

  const items = pendingParsed;
  // Phase 10 step 2 — track which people were genuinely NEW this parse (vs already existing)
  // so we can nudge for their cash advance right after, instead of leaving them silently at
  // the default cashAdvance: 0 forever (Known Gap #3).
  const newlyCreatedPersonIds = [];
  items.forEach(p => {
    let ownerId;
    if (p.ownerName && p.ownerName.trim().toLowerCase() === 'shared') {
      ownerId = 'shared';
    } else if (p.ownerName) {
      const beforePeopleCount = State.people.length;
      ownerId = State.findOrCreatePerson(p.ownerName);
      if (State.people.length > beforePeopleCount && !newlyCreatedPersonIds.includes(ownerId)) {
        newlyCreatedPersonIds.push(ownerId);
      }
    } else {
      ownerId = 'me';
    }
    State.addItem(p.name, p.price || 0, ownerId, 'cash', p.qty, p.unit || '', p.category || '');
  });

  el.scratchText.value = '';
  resetScratchPreview();
  closeAddSheet();
  renderAll();

  const newPeople = [...new Set(items.map(p => p.ownerName).filter(n => n && n.toLowerCase() !== 'shared'))];
  const combinedCount = items.filter(p => p.ownerName && p.ownerName.toLowerCase() === 'shared').length;
  const peopleNote = newPeople.length ? ` Tagged to: ${newPeople.join(', ')}.` : '';
  const combinedNote = combinedCount ? ` ${combinedCount} combined into Shared.` : '';

  toast(`Added ${items.length} item(s), sorted by category.${peopleNote}${combinedNote}`, 'success');

  // Nudge for a cash advance on each newly auto-created person, one at a time, right after
  // the add sheet closes — Cancel/backdrop-dismiss simply skips that person and moves to the
  // next; nothing here is mandatory.
  if (newlyCreatedPersonIds.length) {
    cashNudgeQueue = [...newlyCreatedPersonIds];
    processCashNudgeQueue();
  }
});

// ---------- Phase 3 — Gemini Vision receipt scan ----------
// Photographs a receipt, matches each printed line item to an existing list item by name,
// and auto-fills its price. Line items on the receipt that don't match anything in the list
// are shown in a "not in your list" section — Phase 4 makes those tappable to add directly.

// Phase 2.15: a raw phone-camera photo (often 3-8MB as JPEG) blows straight through Vercel
// Serverless Functions' hard 4.5MB request-body limit — that's what the "Gemini API error
// (413)" was, not anything Gemini-side. Downscaling + re-encoding client-side on a canvas
// keeps the actual upload well under that limit while staying plenty readable for OCR/matching
// (receipts are text-heavy, not detail-heavy — 1600px on the long edge is more than enough).
function compressImageForUpload(file, maxDim = 1600, startQuality = 0.72) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      // Keep the final base64 comfortably under Vercel's 4.5MB body limit (leaving headroom
      // for the item list + JSON overhead), stepping quality down further if still too big.
      const maxBase64Bytes = 3.2 * 1024 * 1024;
      let quality = startQuality;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > maxBase64Bytes && quality > 0.35) {
        quality -= 0.12;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      resolve(dataUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read the photo file.')); };
    img.src = objectUrl;
  });
}

// Phase 10 step 3 — "Skip Gemini (use local OCR)" toggle in the receipt source sheet.
// Sticky across scans (not auto-reset) so a user who knows they're offline/out of quota for
// this whole shopping trip doesn't have to re-toggle it every single scan.
let forceLocalOcr = false;
function setLocalOcrToggle(active) {
  forceLocalOcr = active;
  el.receiptSourceLocalToggle.dataset.active = active;
  el.receiptSourceLocalToggleDot.className = active
    ? 'inline-block w-2 h-2 rounded-full bg-troli-green dark:bg-troli-greenlight shrink-0'
    : 'inline-block w-2 h-2 rounded-full bg-troli-sub dark:bg-troli-subdark shrink-0';
  el.receiptSourceLocalToggle.className = active
    ? 'w-full flex items-center justify-between gap-3 text-xs rounded-xl px-4 py-2.5 border border-troli-green dark:border-troli-greenlight active:scale-95 transition-transform mt-3 bg-troli-green/10'
    : 'w-full flex items-center justify-between gap-3 text-xs rounded-xl px-4 py-2.5 border border-troli-rail dark:border-troli-raildark active:scale-95 transition-transform mt-3';
}
el.receiptSourceLocalToggle.addEventListener('click', () => setLocalOcrToggle(!forceLocalOcr));

// Single "📸 Receipt" button opens a small action sheet so the header doesn't need two
// separate always-visible buttons for camera vs gallery — that's what was making the action
// row look cluttered.
el.scanReceiptBtn.addEventListener('click', () => {
  if (!navigator.onLine && !forceLocalOcr) {
    toast('No internet connection — turn on "Skip Gemini" below to use local OCR instead.', 'error');
    el.receiptSourceSheet.classList.remove('hidden');
    return;
  }
  el.receiptSourceSheet.classList.remove('hidden');
});
el.receiptSourceCancelBtn.addEventListener('click', () => el.receiptSourceSheet.classList.add('hidden'));
el.receiptSourceCameraBtn.addEventListener('click', () => {
  el.receiptSourceSheet.classList.add('hidden');
  el.receiptFileInput.value = '';
  el.receiptFileInput.click();
});
el.receiptSourceGalleryBtn.addEventListener('click', () => {
  el.receiptSourceSheet.classList.add('hidden');
  el.receiptUploadInput.value = '';
  el.receiptUploadInput.click();
});
el.receiptFileInput.addEventListener('change', () => {
  const file = el.receiptFileInput.files && el.receiptFileInput.files[0];
  if (file) handleReceiptFile(file);
});
el.receiptUploadInput.addEventListener('change', () => {
  const file = el.receiptUploadInput.files && el.receiptUploadInput.files[0];
  if (file) handleReceiptFile(file);
});

// ---------- Phase 9 step 3 — local OCR fallback (Gemini outage resilience) ----------
// If the Gemini-backed /api/match-receipt call fails for ANY reason (network error, timeout,
// 429/503 exhausted after rotation+retries, any other server error), a full quota/outage day
// used to dead-end in a bare error toast with nothing to show for the scan. This mirrors the
// Shoppy-With-Wifey reference project's approach: fall back to OCR'ing the photo locally in
// the browser (Tesseract.js, loaded from CDN only when actually needed — never on normal
// happy-path scans) and regex-extracting {name, price} lines. There's no AI matching in this
// path (Tesseract has no concept of the shopper's list), so everything it finds comes back as
// "extras" — the existing dropdown-assign UI (Phase 5) is exactly the right tool for the user
// to manually route each local-OCR'd line to a list item or add it fresh. Lower accuracy than
// Gemini Vision, but "something to work with" beats "nothing" during an outage.
// Phase 10 step 3 also reuses this same path as a MANUAL, user-chosen entry point (not just an
// automatic failure fallback) via the "Skip Gemini" toggle above.
let tesseractLoadPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => resolve();
    script.onerror = () => { tesseractLoadPromise = null; reject(new Error('Could not load the local OCR library (offline or CDN blocked).')); };
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

// Lines this receipt-common vocabulary matches are metadata (totals, tax, payment method,
// loyalty points, card refs), not purchased items — skip them so they don't pollute extras.
const RECEIPT_NOISE_RE = /total|subtotal|jumlah|tax\b|gst|sst|cash\b|tunai|change\b|baki|diskaun|discount|round|bulat|point|member|kad|visa|master|approved|ref\s*no|invoice|receipt\s*no|cashier|terminal/i;
// A purchased line generally ends in a price like "12.50" or "12,50" (some receipt fonts/OCR
// misreads use a comma). Everything before that trailing price, once cleaned of dot-leaders
// and stray punctuation, is treated as the item name.
const TRAILING_PRICE_RE = /(\d{1,4}[.,]\d{2})\s*$/;

function parseReceiptTextLocally(rawText) {
  const lines = String(rawText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const extras = [];
  for (const line of lines) {
    if (RECEIPT_NOISE_RE.test(line)) continue;
    const m = line.match(TRAILING_PRICE_RE);
    if (!m) continue;
    const price = parseFloat(m[1].replace(',', '.'));
    if (isNaN(price) || price <= 0 || price > 2000) continue;
    const name = line.slice(0, m.index).replace(/[-.\s]+$/, '').trim();
    if (!name || name.length < 2) continue;
    extras.push({ name, price });
  }
  return extras;
}

async function runLocalOcrFallback(dataUrl) {
  await loadTesseract();
  const { data } = await window.Tesseract.recognize(dataUrl, 'eng');
  return parseReceiptTextLocally(data.text);
}

async function handleReceiptFile(file) {
  el.receiptScanningOverlay.classList.remove('hidden');
  let dataUrl;
  try {
    dataUrl = await compressImageForUpload(file);
  } catch (err) {
    toast(err.message || 'Could not read the photo file.', 'error');
    el.receiptScanningOverlay.classList.add('hidden');
    return;
  }

  // Phase 10 step 3 — user explicitly asked to skip Gemini entirely for this scan. Go straight
  // to local OCR, no Gemini call/timeout wait at all, same result shape as the automatic
  // failure-triggered fallback below (usedFallback=true banner).
  if (forceLocalOcr) {
    el.receiptScanningLabel.textContent = 'Reading receipt locally (OCR)…';
    try {
      const extras = await runLocalOcrFallback(dataUrl);
      renderAll();
      showReceiptResult([], extras, true);
    } catch (fallbackErr) {
      toast(fallbackErr.message || 'Local OCR failed. Check your connection to load the OCR library, or try again.', 'error');
    } finally {
      el.receiptScanningOverlay.classList.add('hidden');
      el.receiptScanningLabel.textContent = 'Reading your receipt…';
    }
    return;
  }

  // Only offer items still on the To Buy list as match candidates — items a previous
  // receipt scan already moved to Bought (multi-stop shopping) shouldn't be re-matchable.
  // Phase 11: qty is sent too, so match-receipt.js can allow more than one receipt line to
  // match the SAME list item when its merged qty > 1 (e.g. "Ayam" qty 2, combined from two
  // people's requests, legitimately bought as 2 separate weighed receipt lines).
  const items = State.items.filter(i => !i.scanned).map(i => ({ id: i.id, name: i.name, qty: i.qty }));

  try {
    const controller = new AbortController();
    // Phase 9 step 2: match-receipt.js now does TWO sequential Gemini calls server-side (OCR
    // then a separate text-only match call, ~13s budget each = up to ~26s worst case) instead
    // of one combined call — this client timeout was bumped from 25s to 40s to match, and
    // vercel.json's maxDuration for this function was bumped 30s -> 45s alongside it.
    const timeout = setTimeout(() => controller.abort(), 40000);
    let res;
    try {
      res = await fetch('/api/match-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Always JPEG here — the canvas re-encode above normalizes the format regardless of
        // what the original photo/file was.
        body: JSON.stringify({ image: dataUrl, mimeType: 'image/jpeg', items }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (e) { /* ignore — Vercel's own error pages aren't JSON */ }
      throw new Error(detail ? `Gemini API error: ${detail}` : `Gemini API error (${res.status}).`);
    }

    const data = await res.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const extras = Array.isArray(data.extras) ? data.extras : [];

    // Phase 11 — GROUP matches by itemId instead of assuming one-to-one. A list item whose
    // qty was merged from multiple people's requests (e.g. "Ayam" qty 2) can legitimately be
    // fulfilled by MORE THAN ONE receipt line (e.g. 2 separate weighed chicken purchases).
    // match-receipt.js now allows this server-side (capped at the item's own qty), so the
    // client has to handle >1 match per itemId instead of silently only ever applying the
    // last one via a plain forEach + updateItem overwrite.
    const matchGroups = {};
    matches.forEach(m => { (matchGroups[m.itemId] = matchGroups[m.itemId] || []).push(m); });

    Object.keys(matchGroups).forEach((itemId) => {
      const group = matchGroups[itemId];
      const original = State.items.find(i => i.id === itemId);
      if (!original) return;

      const neededQty = (original.qty === null || original.qty === undefined) ? 1 : Math.max(1, Math.floor(original.qty));
      const snapshot = { owner: original.owner, category: original.category, unit: original.unit, paymentMode: original.paymentMode, name: original.name };

      group.forEach((m, idx) => {
        if (idx === 0) {
          // First receipt line reuses the original record — one confirmed unit bought. The
          // receipt is ground truth for name/price; qty collapses to 1 since this record now
          // represents exactly one purchased unit.
          State.updateItem(itemId, { name: m.receiptName || snapshot.name, price: m.price, qty: 1, scanned: true, inTrolley: true });
        } else {
          // Additional receipt line(s) for the SAME list item — clone a new Bought record
          // instead of overwriting/losing the earlier match.
          State.addItem(m.receiptName || snapshot.name, m.price, snapshot.owner, snapshot.paymentMode, 1, snapshot.unit, snapshot.category, true);
          const cloned = State.items[State.items.length - 1];
          State.updateItem(cloned.id, { inTrolley: true });
        }
      });

      // Any quantity still not accounted for by a receipt line stays on the To Buy list as
      // its own remaining-qty record, instead of silently vanishing (e.g. list said qty 2,
      // receipt only had 1 matching line so far — the 2nd is still owed).
      const leftover = neededQty - group.length;
      if (leftover > 0) {
        State.addItem(snapshot.name, 0, snapshot.owner, snapshot.paymentMode, leftover, snapshot.unit, snapshot.category, false);
      }
    });

    renderAll();
    showReceiptResult(matches, extras, false);
    el.receiptScanningOverlay.classList.add('hidden');
  } catch (err) {
    // Gemini path failed outright (network/timeout/quota/server error) — try local OCR before
    // giving up entirely. Skipped for the 413 case previously handled above only in spirit:
    // local OCR runs client-side on the already-compressed dataUrl, so it works regardless of
    // why the upload path failed.
    toast('Gemini unavailable — trying local OCR fallback…', 'info');
    try {
      const extras = await runLocalOcrFallback(dataUrl);
      renderAll();
      showReceiptResult([], extras, true);
    } catch (fallbackErr) {
      const msg = err.name === 'AbortError'
        ? 'Gemini took too long to read the receipt (timeout), and the local OCR fallback also failed. Try a clearer photo or better lighting.'
        : (fallbackErr.message || 'Could not read the receipt via Gemini or locally. Check your connection and try again.');
      toast(msg, 'error');
    } finally {
      el.receiptScanningOverlay.classList.add('hidden');
    }
  }
}

// Phase 5: "extras" (receipt line items that didn't fuzzy-match anything already on the To
// Buy list) get a dropdown instead of a flat "+ Add" button — most real receipts have
// abbreviations/formatting the auto-matcher won't catch (e.g. "AYAM SEGAR/KG" vs "Ayam"), so
// the user picks the right existing item themselves, or adds it fresh if it's genuinely new.
// Matched items stay read-only rows — handleReceiptFile() already renamed/priced/moved them
// to Bought before this renders.
function showReceiptResult(matches, extras, usedFallback = false) {
  const matchRows = matches.map(m => {
    const item = State.items.find(i => i.id === m.itemId);
    const label = item ? item.name : (m.receiptName || m.itemId);
    return `<li class="text-sm bg-troli-bg dark:bg-troli-bgdark rounded-xl px-3 py-2 flex items-center justify-between"><span>${escapeHtml(label)}</span><span class="font-semibold">${fmt(m.price)}</span></li>`;
  }).join('');

  let bodyHtml = '';
  // Phase 9 step 3 / Phase 10 step 3: local Tesseract OCR ran instead of Gemini (outage/quota/
  // network fallback, OR the user manually chose "Skip Gemini") — it can't smart-match against
  // the list at all, so every line lands in extras below. Flag this clearly so the user knows
  // to double-check names/prices before assigning.
  if (usedFallback) {
    bodyHtml += `<p class="text-[11px] text-troli-orange bg-troli-orange/10 border border-troli-orange/30 rounded-xl px-3 py-2 mb-3">⚠️ Used local OCR instead of Gemini. Accuracy is lower and nothing was auto-matched; please check names/prices below before assigning.</p>`;
  }
  if (matches.length) {
    bodyHtml += `<p class="text-[11px] uppercase tracking-wider text-troli-sub dark:text-troli-subdark mb-1">Matched &amp; moved to Bought (${matches.length})</p><ul class="space-y-1.5 mb-3">${matchRows}</ul>`;
  }
  if (extras.length) {
    bodyHtml += `<p class="text-[11px] uppercase tracking-wider text-troli-sub dark:text-troli-subdark mb-1">On receipt but not recognized (${extras.length})</p><p class="text-[11px] text-troli-sub dark:text-troli-subdark mb-2">Assign each to an item on your To Buy list, or add it as new.</p><ul id="receiptExtrasList" class="space-y-1.5"></ul>`;
  }
  if (!matches.length && !extras.length) {
    bodyHtml = `<p class="text-sm text-troli-sub dark:text-troli-subdark">${usedFallback ? 'Local OCR' : 'Gemini'} couldn't read any line items off that photo — try a clearer, well-lit shot.</p>`;
  }

  el.receiptBody.innerHTML = bodyHtml;
  if (!extras.length) return;

  const extrasList = document.getElementById('receiptExtrasList');
  // Candidates are whatever's still on the To Buy list right now — matches already flipped
  // their items to scanned/Bought above, so those correctly don't show up as assignable here.
  let candidates = State.items.filter(i => !i.scanned);

  extras.forEach((e) => {
    const li = document.createElement('li');
    li.className = 'text-sm bg-troli-orange/10 border border-troli-orange/30 rounded-xl px-3 py-2';
    li.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <p class="truncate flex-1 min-w-0">${escapeHtml(e.name)}</p>
        <span class="font-semibold shrink-0">${fmt(e.price)}</span>
      </div>
      <select class="assignSelect w-full bg-troli-card dark:bg-troli-carddark rounded-lg px-2 py-1.5 text-xs border border-troli-rail dark:border-troli-raildark outline-none">
        <option value="__new__">+ Add as new item</option>
        ${candidates.map(c => `<option value="${c.id}">Assign to: ${escapeHtml(c.name)}</option>`).join('')}
      </select>
    `;

    const select = li.querySelector('.assignSelect');
    select.addEventListener('change', () => {
      const chosen = select.value;
      if (chosen === '__new__') {
        // qty left null/TBD on purpose — a receipt gives a confirmed price, not a countable
        // qty, mirroring how manually-added items start with price TBD instead.
        State.addItem(e.name, e.price, 'me', 'cash', null, '', '', true);
        const newItem = State.items[State.items.length - 1];
        State.updateItem(newItem.id, { inTrolley: true });
      } else {
        State.updateItem(chosen, { name: e.name, price: e.price, scanned: true, inTrolley: true });
        // That item is no longer a valid target for any other still-open extra row.
        candidates = candidates.filter(c => c.id !== chosen);
        document.querySelectorAll('.assignSelect').forEach((otherSelect) => {
          if (otherSelect === select) return;
          const opt = otherSelect.querySelector(`option[value="${chosen}"]`);
          if (opt) opt.remove();
        });
      }
      renderAll();
      const tag = document.createElement('span');
      tag.className = 'text-[11px] text-troli-green dark:text-troli-greenlight font-semibold';
      tag.textContent = `Added to Bought as "${e.name}" ✓`;
      select.replaceWith(tag);
      toast(`${e.name} added to Bought`, 'success');
    });

    extrasList.appendChild(li);
  });
}
el.receiptCloseBtn.addEventListener('click', () => el.receiptModal.classList.add('hidden'));

// ---------- Global backdrop-click-to-close ----------
// Every modal's root element IS its own dark backdrop (fixed inset-0 overlay), with the
// actual card as a nested child — same structure el.addSheet already used its own backdrop
// listener for. Extending that pattern to every other modal instead of only the ones with an
// explicit Cancel/Close button. receiptScanningOverlay is deliberately excluded: it's an
// active loading state mid-request, not something the user should be able to dismiss early.
function closeAnyModal(modalEl) {
  modalEl.classList.add('hidden');
  if (modalEl === el.editModal) editingId = null;
  if (modalEl === el.markBoughtModal) markBoughtId = null;
  if (modalEl === el.personModal) {
    editingPersonId = null;
    if (cashNudgeQueue.length) processCashNudgeQueue(); // backdrop-dismissing a nudge still advances the queue
  }
}
[el.personModal, el.settleModal, el.editModal, el.adjustModal, el.receiptModal, el.receiptSourceSheet, el.markBoughtModal].forEach((modalEl) => {
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeAnyModal(modalEl); });
});

// ---------- Init ----------
State.load();
setActiveTab('tobuy');
checkGeminiConnection(true);
setAddMode('structured');
setLocalOcrToggle(false);
