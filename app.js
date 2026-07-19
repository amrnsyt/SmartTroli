// SmartTroli (KongsiTroli) — app.js
// Phase 1+2: shared-expense engine + Gemini-powered scratchpad parsing.
// Items are captured QTY-FIRST (name + quantity), price is optional and filled in
// at the shelf/checkout — this matches how real chaotic family lists actually start.

const ITEMS_KEY = 'smarttroli_items_v3';
const PEOPLE_KEY = 'smarttroli_people_v2';
const ADJ_KEY = 'smarttroli_adjustments_v2';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmt = (n) => `RM ${(Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)}`;

// ---------- STATE ----------
const State = {
  items: [],       // { id, name, qty, unit, price, inTrolley, owner, paymentMode }
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

  addItem(name, price = 0, owner = 'me', paymentMode = 'cash', qty = 1, unit = '') {
    this.items.push({
      id: uid(),
      name: name.trim(),
      qty: parseFloat(qty) || 1,
      unit: (unit || '').trim(),
      price: parseFloat(price) || 0,
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
  modeToggleBtn: document.getElementById('modeToggleBtn'),
  scratchWrap: document.getElementById('scratchWrap'),
  scratchText: document.getElementById('scratchText'),
  scratchParseBtn: document.getElementById('scratchParseBtn'),
  scratchSkeleton: document.getElementById('scratchSkeleton'),
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

  li.innerHTML = `
    <div class="editRow absolute inset-0 flex items-center justify-end gap-2 px-3 bg-troli-orange/90">
      <button class="editBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/20 rounded-full">Edit</button>
      <button class="delBtn text-white text-xs font-semibold px-3 py-1.5 bg-black/30 rounded-full">Delete</button>
    </div>
    <div class="swipeRow bg-troli-card dark:bg-troli-carddark px-4 py-3 flex items-center gap-3 relative" style="transform: translateX(0px); transition: transform .18s ease;">
      <input type="checkbox" class="troli-check" ${item.inTrolley ? 'checked' : ''}>
      <div class="flex-1 min-w-0">
        <p class="strike-anim text-sm font-medium truncate ${item.inTrolley ? 'line-through decoration-troli-green dark:decoration-troli-greenlight opacity-50' : ''}">
          ${escapeHtml(item.name)}
          ${(item.qty && item.qty !== 1) || item.unit ? `<span class="text-troli-orange font-normal">· ${item.qty}${item.unit ? ' ' + escapeHtml(item.unit) : 'x'}</span>` : ''}
        </p>
        <p class="text-[11px] text-troli-sub dark:text-troli-subdark truncate">${item.owner === 'shared' ? 'Shared (Kongsi)' : escapeHtml(personName(item.owner))} · ${item.paymentMode === 'digital' ? 'Digital/QR' : 'Cash'}</p>
      </div>
      <span class="strike-anim text-sm font-display ${item.inTrolley ? 'line-through opacity-50' : ''} ${item.price === 0 ? 'text-troli-orange' : ''}">${item.price === 0 ? 'Add price' : fmt(item.price)}</span>
    </div>
  `;

  const swipeRow = li.querySelector('.swipeRow');
  li.querySelector('.troli-check').addEventListener('change', () => { State.toggleItem(item.id); renderAll(); });
  li.querySelector('.delBtn').addEventListener('click', () => { State.removeItem(item.id); renderAll(); });
  li.querySelector('.editBtn').addEventListener('click', () => openEditModal(item));

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

function openEditModal(item) {
  editingId = item.id;
  el.editName.value = item.name;
  el.editQty.value = item.qty || 1;
  el.editUnit.value = item.unit || '';
  el.editPrice.value = item.price || 0;
  renderOwnerOptions(el.editOwnerSelect, item.owner);
  el.editPayToggle.dataset.mode = item.paymentMode;
  el.editPayToggle.textContent = item.paymentMode === 'digital' ? '📱 Digital' : '💵 Cash';
  el.editModal.classList.remove('hidden');
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
    qty: parseFloat(el.editQty.value) || 1,
    unit: el.editUnit.value.trim(),
    price: parseFloat(el.editPrice.value) || 0,
    owner: el.editOwnerSelect.value,
    paymentMode: el.editPayToggle.dataset.mode
  });
  editingId = null;
  el.editModal.classList.add('hidden');
  renderAll();
});

function renderAll() {
  el.list.innerHTML = '';
  if (State.items.length === 0) { el.empty.classList.remove('hidden'); }
  else { el.empty.classList.add('hidden'); State.items.forEach(i => el.list.appendChild(renderItem(i))); }

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
el.modeToggleBtn.addEventListener('click', () => {
  const showingScratch = !el.scratchWrap.classList.contains('hidden');
  el.scratchWrap.classList.toggle('hidden', showingScratch);
  el.structuredForm.classList.toggle('hidden', !showingScratch);
  el.modeToggleBtn.textContent = showingScratch ? '📝 Scratchpad' : '📋 Structured';
});

// Qty-first local fallback parser (used when Gemini is unreachable).
// Priority: 1) explicit RM price at end -> price-based item (qty=1)
//           2) trailing "<number> <unit>" -> qty-based item (price=0, fill in later)
//           3) no signal -> qty=1, price=0
const UNIT_WORDS = 'ekor|batang|biji|ulas|ikat|kg|g|gram|ml|l|liter|pcs|pkt|pack|packet|bungkus|kotak|tin|botol|dozen|lusin';

function parseScratchLine(line) {
  // 1) Explicit price at the end, e.g. "Milk 1L RM12.50" or "Milk 1L 12.50"
  const priceMatch = line.match(/RM\s?(\d+(?:\.\d{1,2})?)\s*$/i);
  if (priceMatch) {
    const price = parseFloat(priceMatch[1]);
    const name = line.slice(0, priceMatch.index).replace(/[-–—:]+\s*$/, '').trim();
    if (name) return { name, price, qty: 1, unit: '' };
  }

  // 2) Trailing quantity + unit, e.g. "Ayam sekoq potong kecik 2 ekor" or "Carrot 2 batang"
  const qtyMatch = line.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_WORDS})\\.?\\s*$`, 'i'));
  if (qtyMatch) {
    const qty = parseFloat(qtyMatch[1]);
    const unit = qtyMatch[2];
    const name = line.slice(0, qtyMatch.index).replace(/[-–—:]+\s*$/, '').trim();
    if (name) return { name, price: 0, qty, unit };
  }

  // 3) Bare trailing number with no unit and no RM/decimal — treat as quantity, not price
  const bareNumMatch = line.match(/(\d+)\s*$/);
  if (bareNumMatch && !line.match(/\.\d{1,2}\s*$/)) {
    const qty = parseFloat(bareNumMatch[1]);
    const name = line.slice(0, bareNumMatch.index).replace(/[-–—:]+\s*$/, '').trim();
    if (name) return { name, price: 0, qty, unit: '' };
  }

  const name = line.trim();
  if (!name) return null;
  return { name, price: 0, qty: 1, unit: '' };
}

function localParseFallback(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const parsed = [];
  lines.forEach(line => {
    const p = parseScratchLine(line);
    if (p) {
      const existing = parsed.find(x => x.name.toLowerCase() === p.name.toLowerCase() && x.unit === p.unit);
      if (existing) { existing.qty += p.qty; existing.price += p.price; }
      else parsed.push(p);
    }
  });
  return parsed;
}

function setScratchLoading(isLoading) {
  el.scratchParseBtn.disabled = isLoading;
  el.scratchText.disabled = isLoading;
  el.scratchSkeleton.classList.toggle('hidden', !isLoading);
  el.scratchParseBtn.textContent = isLoading ? 'Parsing…' : 'Parse into list';
}

async function parseWithGemini(rawText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch('/api/parse-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Gemini API request failed');
    const data = await res.json();
    if (!Array.isArray(data.items)) throw new Error('Unexpected response shape');
    return data.items;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

el.scratchParseBtn.addEventListener('click', async () => {
  const rawText = el.scratchText.value;
  if (!rawText.trim()) return;

  setScratchLoading(true);
  let parsed = [];
  let usedFallback = false;

  try {
    parsed = await parseWithGemini(rawText);
  } catch (err) {
    // Offline or Gemini unavailable — fall back to local regex parser so the
    // app keeps working with poor supermarket signal (offline-first requirement).
    usedFallback = true;
    parsed = localParseFallback(rawText);
  }

  setScratchLoading(false);

  if (!parsed || parsed.length === 0) {
    toast(usedFallback
      ? 'No signal reached Gemini and local parsing found nothing. Try one item per line.'
      : 'Gemini could not detect any items in that text.', 'error');
    return;
  }

  parsed.forEach(p => State.addItem(p.name, p.price || 0, 'me', 'cash', p.qty || 1, p.unit || ''));
  el.scratchText.value = '';
  el.modeToggleBtn.click(); // switch back to structured view to review/edit
  renderAll();

  toast(
    usedFallback
      ? `Parsed locally (offline) — ${parsed.length} item(s) added by quantity. Add prices at the shelf.`
      : `Gemini parsed ${parsed.length} item(s) by quantity — add prices as you shop.`,
    usedFallback ? 'info' : 'success'
  );
});

// ---------- Init ----------
State.load();
renderAll();
checkGeminiConnection(true);
