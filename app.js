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
  items: [],       // { id, name, qty (number|null), unit, price, category, inTrolley, owner, paymentMode }
  people: [],      // { id, name, isMe, cashAdvance }
  adjustments: { discount: 0, rounding: 0 },

  load() {
    try { this.items = JSON.parse(localStorage.getItem(ITEMS_KEY)) || []; } catch (e) { this.items = []; }
    try { this.people = JSON.parse(localStorage.getItem(PEOPLE_KEY)) || null; } catch (e) { this.people = null; }
    if (!this.people || this.people.length === 0) {
      this.people = [{ id: 'me', name: 'Me', isMe: true, cashAdvance: 0 }];
    }
    try { this.adjustments = JSON.parse(localStorage.getItem(ADJ_KEY)) || { discount: 0, rounding: 0 }; } catch (e) { this.adjustments = { discount: 0, rounding: 0 }; }
  },
  saveItems() { localStorage.setItem(ITEMS_KEY, JSON.stringify(this.items)); },
  savePeople() { localStorage.setItem(PEOPLE_KEY, JSON.stringify(this.people)); },
  saveAdj() { localStorage.setItem(ADJ_KEY, JSON.stringify(this.adjustments)); },

  addItem(name, price = 0, owner = 'me', paymentMode = 'cash', qty = 1, unit = '', category = '') {
    this.items.push({
      id: uid(),
      name: name.trim(),
      qty: normalizeQty(qty),
      unit: (unit || '').trim(),
      price: parseFloat(price) || 0,
      category: (category || '').trim(),
      inTrolley: false,
      owner,
      paymentMode
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
    const newPerson = { id: uid(), name: trimmed, isMe: false, cashAdvance: 0 };
    this.people.push(newPerson);
    this.savePeople();
    return newPerson.id;
  },

  addPerson(name, cashAdvance) {
    this.people.push({ id: uid(), name: name.trim(), isMe: false, cashAdvance: parseFloat(cashAdvance) || 0 });
    this.savePeople();
  },
  removePerson(id) {
    if (id === 'me') return;
    this.people = this.people.filter(p => p.id !== id);
    // reassign orphaned items back to Me
    this.items.forEach(i => { if (i.owner === id) i.owner = 'me'; });
    this.savePeople(); this.saveItems();
  },

  estimatedTotal() { return this.items.reduce((s, i) => s + i.price, 0); },
  trolleyTotal() { return this.items.filter(i => i.inTrolley).reduce((s, i) => s + i.price, 0); },
  progressPercent() {
    if (this.items.length === 0) return 0;
    return Math.round((this.items.filter(i => i.inTrolley).length / this.items.length) * 100);
  },

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
    const peopleCount = this.people.length;
    const sharedItems = this.items.filter(i => i.owner === 'shared');
    const sharedCashTotal = sharedItems.filter(i => i.paymentMode === 'cash').reduce((s, i) => s + i.price, 0);
    const sharedDigitalTotal = sharedItems.filter(i => i.paymentMode === 'digital').reduce((s, i) => s + i.price, 0);

    const results = [];
    this.people.filter(p => !p.isMe).forEach(person => {
      const ownItems = this.items.filter(i => i.owner === person.id);
      const cashPortion = ownItems.filter(i => i.paymentMode === 'cash').reduce((s, i) => s + i.price, 0) + (sharedCashTotal / peopleCount);
      const digitalPortion = ownItems.filter(i => i.paymentMode === 'digital').reduce((s, i) => s + i.price, 0) + (sharedDigitalTotal / peopleCount);

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

      results.push({ person: person.name, total: ownItems.reduce((s, i) => s + i.price, 0) + (sharedItems.reduce((s, i) => s + i.price, 0) / peopleCount), lines });
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
  railFill: document.getElementById('railFill'),
  railPercent: document.getElementById('railPercent'),
  itemCount: document.getElementById('itemCount'),
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
  scratchText: document.getElementById('scratchText'),
  scratchParseBtn: document.getElementById('scratchParseBtn'),
  scratchSkeleton: document.getElementById('scratchSkeleton'),
  scratchError: document.getElementById('scratchError'),
  structuredForm: document.getElementById('structuredFormWrap'),
  // modals
  personModal: document.getElementById('personModal'),
  personName: document.getElementById('personName'),
  personCash: document.getElementById('personCash'),
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
    chip.className = 'flex items-center gap-1 bg-troli-card dark:bg-troli-carddark border border-troli-rail dark:border-troli-raildark rounded-full pl-3 pr-2 py-1 text-xs shrink-0';
    chip.innerHTML = `<span class="font-medium">${escapeHtml(p.name)}</span>${!p.isMe ? `<span class="text-troli-sub dark:text-troli-subdark">· ${fmt(p.cashAdvance || 0)}</span>` : ''}`;
    if (!p.isMe) {
      const x = document.createElement('button');
      x.textContent = '✕';
      x.className = 'ml-1 text-troli-sub dark:text-troli-subdark';
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

  li.innerHTML = `
    <div class="editRow absolute inset-0 flex items-center justify-end gap-2 px-3 bg-troli-orange/90">
      <button class="editBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/20 rounded-full">Edit</button>
      <button class="delBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/30 rounded-full">Delete</button>
    </div>
    <div class="swipeRow bg-troli-card dark:bg-troli-carddark px-4 py-3 flex items-center gap-3 relative" style="transform: translateX(0px); transition: transform .18s ease;">
      <input type="checkbox" class="troli-check" ${item.inTrolley ? 'checked' : ''}>
      <div class="flex-1 min-w-0">
        <p class="strike-anim text-sm font-medium truncate ${item.inTrolley ? 'line-through decoration-troli-green dark:decoration-troli-greenlight opacity-50' : ''}">${escapeHtml(item.name)}</p>
        <p class="text-[11px] text-troli-sub dark:text-troli-subdark truncate">${item.owner === 'shared' ? 'Shared (Kongsi)' : escapeHtml(personName(item.owner))} · ${item.paymentMode === 'digital' ? 'Digital/QR' : 'Cash'} · ${item.price > 0 ? escapeHtml(priceText) : '<span class="italic">Price TBD</span>'}</p>
      </div>
      ${hasQty
        ? `<span class="strike-anim text-sm font-display font-semibold shrink-0 ${item.inTrolley ? 'line-through opacity-50' : ''}">${qtyDisplay}</span>`
        : `<button class="addQtyBtn text-xs font-semibold text-troli-orange border border-troli-orange/50 rounded-full px-3 py-1.5 shrink-0 active:scale-95 transition-transform">+ Add Qty</button>`
      }
    </div>
  `;

  const swipeRow = li.querySelector('.swipeRow');
  li.querySelector('.troli-check').addEventListener('change', () => { State.toggleItem(item.id); renderAll(); });
  li.querySelector('.delBtn').addEventListener('click', () => { State.removeItem(item.id); renderAll(); });
  li.querySelector('.editBtn').addEventListener('click', () => openEditModal(item));
  const addQtyBtn = li.querySelector('.addQtyBtn');
  if (addQtyBtn) addQtyBtn.addEventListener('click', () => openEditModal(item, 'qty'));

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

const CATEGORY_ORDER = ['Sayur-sayuran', 'Buah-buahan', 'Daging & Ayam', 'Ikan & Makanan Laut', 'Tenusu', 'Perencah & Sos', 'Lain-lain'];

function sortedCategories(categories) {
  return categories.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function renderAll() {
  el.list.innerHTML = '';
  if (State.items.length === 0) {
    el.empty.classList.remove('hidden');
  } else {
    el.empty.classList.add('hidden');

    const groups = {};
    State.items.forEach(i => {
      const cat = i.category || 'Lain-lain';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(i);
    });
    const categoryNames = Object.keys(groups);

    if (categoryNames.length <= 1) {
      // Flat list — no point showing a single category header.
      State.items.forEach(i => el.list.appendChild(renderItem(i)));
    } else {
      sortedCategories(categoryNames).forEach(cat => {
        const header = document.createElement('li');
        header.className = 'sticky top-0 z-10 bg-troli-bg/95 dark:bg-troli-bgdark/95 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-wider text-troli-green dark:text-troli-greenlight px-1 py-1.5 -mx-2 -mt-2';
        header.textContent = cat;
        el.list.appendChild(header);
        groups[cat].forEach(i => el.list.appendChild(renderItem(i)));
      });
    }
  }

  el.estTotal.textContent = fmt(State.estimatedTotal());
  el.troliTotal.textContent = fmt(State.trolleyTotal());
  el.itemCount.textContent = `${State.items.length} item${State.items.length === 1 ? '' : 's'}`;
  const pct = State.progressPercent();
  el.railFill.style.width = `${pct}%`;
  el.railPercent.textContent = `${pct}%`;

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
    const timeout = setTimeout(() => controller.abort(), 8000);
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

// ---------- People modal ----------
el.addPersonBtn.addEventListener('click', () => {
  el.personName.value = ''; el.personCash.value = '';
  el.personModal.classList.remove('hidden');
});
el.personCancelBtn.addEventListener('click', () => el.personModal.classList.add('hidden'));
el.personSaveBtn.addEventListener('click', () => {
  const name = el.personName.value.trim();
  if (!name) return;
  State.addPerson(name, el.personCash.value);
  el.personModal.classList.add('hidden');
  renderAll();
});

// ---------- Settlement modal ----------
el.settleBtn.addEventListener('click', () => {
  const results = State.settlement();
  if (results.length === 0) {
    el.settleBody.innerHTML = `<p class="text-sm text-troli-sub dark:text-troli-subdark">Add a family member with a cash advance to see settlement instructions.</p>`;
  } else {
    el.settleBody.innerHTML = results.map(r => `
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
function openAddSheet() { el.addSheet.classList.remove('hidden'); }
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
    ? 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-green dark:border-troli-greenlight bg-troli-green dark:bg-troli-greenlight text-white'
    : 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-rail dark:border-troli-raildark bg-troli-card dark:bg-troli-carddark';
  el.modeScratchBtn.className = !structured
    ? 'flex-1 text-xs font-semibold rounded-full px-3 py-2 border border-troli-green dark:border-troli-greenlight bg-troli-green dark:bg-troli-greenlight text-white'
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
  const timeout = setTimeout(() => controller.abort(), 12000);
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

  parsed.forEach(p => {
    let ownerId;
    if (p.ownerName && p.ownerName.trim().toLowerCase() === 'shared') {
      ownerId = 'shared';
    } else if (p.ownerName) {
      ownerId = State.findOrCreatePerson(p.ownerName);
    } else {
      ownerId = 'me';
    }
    State.addItem(p.name, p.price || 0, ownerId, 'cash', p.qty, p.unit || '', p.category || '');
  });
  el.scratchText.value = '';
  closeAddSheet();
  renderAll();

  const newPeople = [...new Set(parsed.map(p => p.ownerName).filter(n => n && n.toLowerCase() !== 'shared'))];
  const combinedCount = parsed.filter(p => p.ownerName && p.ownerName.toLowerCase() === 'shared').length;
  const peopleNote = newPeople.length ? ` Tagged to: ${newPeople.join(', ')}.` : '';
  const combinedNote = combinedCount ? ` ${combinedCount} combined into Shared.` : '';

  toast(`Gemini parsed ${parsed.length} item(s), sorted by category.${peopleNote}${combinedNote}`, 'success');
});

// ---------- Init ----------
State.load();
renderAll();
checkGeminiConnection(true);
setAddMode('structured');
