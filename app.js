// app.js — storefront loader (client-filtered)

/* =========================
   0) Small utilities
   ========================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtPrice(price, currency = "usd") {
  try {
    const cur = (currency || "usd").toUpperCase();
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `$${Number(price).toFixed(2)}`;
  }
}

function getUrlParam(name) {
  const u = new URL(window.location.href);
  const v = u.searchParams.get(name);
  return v ? v.trim() : "";
}

function normalizeSkus(list) {
  return (list || [])
    .map(s => (s || "").toString().trim())
    .filter(Boolean);
}

/* =========================
   1) Client filter (no-break)
   ========================= */
/**
 * Priority:
 * 1) window.STORE.SKU_ALLOWLIST (array)
 * 2) window.STORE.SKU_PREFIX (string)
 * 3) URL: ?sku=SKU1,SKU2 or ?prefix=CYS-
 * Always keeps only { active: true }.
 */
function buildFilter() {
  const cfg = window.STORE || {};
  const urlSkuList = getUrlParam("sku");
  const urlPrefix  = getUrlParam("prefix");

  const urlAllow = urlSkuList
    ? urlSkuList.split(",").map(s => s.trim()).filter(Boolean)
    : null;

  return {
    allowlist: normalizeSkus(urlAllow || cfg.SKU_ALLOWLIST || null),
    prefix: (urlPrefix || cfg.SKU_PREFIX || "").trim(),
  };
}

function applyClientFilter(products) {
  const { allowlist, prefix } = buildFilter();

  let filtered = Array.isArray(products)
    ? products.filter(p => p && p.active !== false)
    : [];

  if (allowlist && allowlist.length) {
    const set = new Set(allowlist);
    filtered = filtered.filter(
      p => set.has((p.sku || "").toString().trim())
    );
  } else if (prefix) {
    filtered = filtered.filter(
      p => (p.sku || "").toString().trim().startsWith(prefix)
    );
  }

  return filtered;
}

/* =========================
   2) Data loading
   ========================= */
async function loadProducts() {
  const cfg = window.STORE || {};
  const url = cfg.PRODUCTS_JSON || "data/products.json";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  let products = await res.json();
  products = applyClientFilter(products);
  return products;
}

/* =========================
   3) Rendering
   ========================= */
function ensureContainer() {
  // Try a few common hooks. If none exists, create a grid in <main>.
  let root =
    $('[data-products]') ||
    $('#products') ||
    $('.products') ||
    $('main');

  if (!root) {
    root = document.createElement('main');
    document.body.appendChild(root);
  }

  // If root is <main>, add a grid container inside for consistent layout
  let grid = $('[data-grid]', root);
  if (!grid) {
    grid = document.createElement('div');
    grid.setAttribute('data-grid', '');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
    grid.style.gap = '16px';
    grid.style.alignItems = 'stretch';
    root.appendChild(grid);
  }
  return grid;
}

function cardHTML(p) {
  const name  = p.name || p.sku || 'Product';
  const price = typeof p.price === 'number'
    ? fmtPrice(p.price, p.currency)
    : '';
  const link  = p.link || '#';
  const sku   = p.sku ? String(p.sku) : '';

  // Image support (optional fields): p.image, p.images[0], or nothing
  const img = p.image || (Array.isArray(p.images) ? p.images[0] : '');
  const imgTag = img
    ? `<div class="card__media"><img src="${img}" alt="${name}" loading="lazy"></div>`
    : `<div class="card__media card__media--placeholder"></div>`;

  return `
    <article class="card">
      ${imgTag}
      <div class="card__body">
        <h3 class="card__title" title="${name}">${name}</h3>
        <div class="card__meta">
          ${sku ? `<span class="card__sku" title="SKU">${sku}</span>` : ``}
          ${price ? `<span class="card__price">${price}</span>` : ``}
        </div>
        <a class="card__cta" href="${link}" target="_blank" rel="noopener">Buy</a>
      </div>
    </article>
  `;
}

function injectStylesOnce() {
  if ($('#__storefront_inline_styles')) return;
  const css = `
  [data-grid] .card{display:flex;flex-direction:column;border:1px solid #e6e6e6;border-radius:12px;overflow:hidden;background:#fff}
  .card__media{aspect-ratio:4/3;background:#fafafa;display:flex;align-items:center;justify-content:center}
  .card__media img{width:100%;height:100%;object-fit:cover}
  .card__media--placeholder::after{content:"";width:38%;height:38%;background:repeating-linear-gradient(45deg,#eee,#eee 8px,#f6f6f6 8px,#f6f6f6 16px);border-radius:8px}
  .card__body{padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  .card__title{font-size:1rem;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}
  .card__meta{display:flex;justify-content:space-between;gap:8px;color:#555;font-size:.9rem}
  .card__sku{opacity:.75}
  .card__price{font-weight:600}
  .card__cta{margin-top:auto;display:inline-block;text-align:center;text-decoration:none;background:#111;color:#fff;padding:10px 12px;border-radius:10px}
  .card__cta:hover{background:#000}
  `;
  const el = document.createElement('style');
  el.id = '__storefront_inline_styles';
  el.textContent = css;
  document.head.appendChild(el);
}

async function render() {
  injectStylesOnce();
  const grid = ensureContainer();

  // tiny skeleton
  grid.innerHTML = `<div style="opacity:.6">Loading products…</div>`;

  try {
    const items = await loadProducts();

    if (!items.length) {
      grid.innerHTML = `<div style="opacity:.6">No products found for this storefront.</div>`;
      return;
    }

    grid.innerHTML = items.map(cardHTML).join('');

  } catch (err) {
    console.error(err);
    grid.innerHTML = `<div style="color:#b00">Error loading products. Check the console for details.</div>`;
  }
}

/* =========================
   4) Boot
   ========================= */
document.addEventListener('DOMContentLoaded', render);