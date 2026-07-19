// SmartTroli — app.js
// Modular vanilla JS: state, storage, render, events

const STORAGE_KEY = 'smarttroli_items_v1';

const State = {
  items: [],

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.items = raw ? JSON.parse(raw) : [];
    } catch (e) {
      this.items = [];
    }
  },

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
  },

  addItem(name, price) {
    this.items.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      price: parseFloat(price) || 0,
      inTrolley: false
    });
    this.save();
  },

  toggleItem(id) {
    const item = this.items.find(i => i.id === id);
    if (item) {
      item.inTrolley = !item.inTrolley;
      this.save();
    }
  },

  removeItem(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.save();
  },

  estimatedTotal() {
    return this.items.reduce((sum, i) => sum + i.price, 0);
  },

  trolleyTotal() {
    return this.items
      .filter(i => i.inTrolley)
      .reduce((sum, i) => sum + i.price, 0);
  },

  progressPercent() {
    if (this.items.length === 0) return 0;
    const inTrolley = this.items.filter(i => i.inTrolley).length;
    return Math.round((inTrolley / this.items.length) * 100);
  }
};

const fmt = (n) => `₹${n.toFixed(2)}`;

const el = {
  form: document.getElementById('addForm'),
  name: document.getElementById('itemName'),
  price: document.getElementById('itemPrice'),
  list: document.getElementById('itemList'),
  empty: document.getElementById('emptyState'),
  estTotal: document.getElementById('estTotal'),
  troliTotal: document.getElementById('troliTotal'),
  railFill: document.getElementById('railFill'),
  railPercent: document.getElementById('railPercent'),
  itemCount: document.getElementById('itemCount')
};

function renderItem(item) {
  const li = document.createElement('li');
  li.className = 'bg-troli-card dark:bg-troli-carddark rounded-2xl px-4 py-3 shadow-sm border border-troli-rail dark:border-troli-raildark flex items-center gap-3';

  li.innerHTML = `
    <input type="checkbox" class="troli-check" ${item.inTrolley ? 'checked' : ''} aria-label="Mark ${item.name} in trolley">
    <div class="flex-1 min-w-0">
      <p class="strike-anim text-sm font-medium truncate ${item.inTrolley ? 'line-through decoration-troli-green dark:decoration-troli-greenlight opacity-50' : ''}">${escapeHtml(item.name)}</p>
    </div>
    <span class="strike-anim text-sm font-display ${item.inTrolley ? 'line-through opacity-50' : ''}">${fmt(item.price)}</span>
    <button aria-label="Remove ${item.name}" class="removeBtn w-8 h-8 rounded-full flex items-center justify-center text-troli-sub dark:text-troli-subdark active:scale-90 transition-transform">✕</button>
  `;

  li.querySelector('.troli-check').addEventListener('change', () => {
    State.toggleItem(item.id);
    render();
  });

  li.querySelector('.removeBtn').addEventListener('click', () => {
    State.removeItem(item.id);
    render();
  });

  return li;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function render() {
  el.list.innerHTML = '';
  if (State.items.length === 0) {
    el.empty.classList.remove('hidden');
  } else {
    el.empty.classList.add('hidden');
    State.items.forEach(item => el.list.appendChild(renderItem(item)));
  }

  el.estTotal.textContent = fmt(State.estimatedTotal());
  el.troliTotal.textContent = fmt(State.trolleyTotal());
  el.itemCount.textContent = `${State.items.length} item${State.items.length === 1 ? '' : 's'}`;

  const pct = State.progressPercent();
  el.railFill.style.width = `${pct}%`;
  el.railPercent.textContent = `${pct}%`;
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = el.name.value.trim();
  const price = el.price.value;
  if (!name || price === '') return;

  State.addItem(name, price);
  el.name.value = '';
  el.price.value = '';
  el.name.focus();
  render();
});

State.load();
render();
