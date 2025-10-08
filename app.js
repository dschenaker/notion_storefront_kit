// app.js — minimal, robust storefront SPA
// - Loads ./data/products.json (cache-busted)
// - Grid with cards
// - Product page with variant picker (uses p.images[])
// - Categories in nav + sidebar
// - Defensive rendering so errors don't blank the page

(() => {
  'use strict';

  // ---------- Helpers ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const initials = s => (s||'').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase() || 'C';
  const fmt = new Intl.NumberFormat(undefined, { style:'currency', currency:'USD' });

  const els = {
    root: document.getElementById('app') || document.body
  };

  // Always fetch a fresh copy (avoid stale cache)
  const DATA_URL = './data/products.json?ts=' + Date.now();

  let products = [];
  let view = { q:'', cat:'', sort:'featured' };

  async function loadProducts(){
    const res = await fetch(DATA_URL, { cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error('Malformed products.json (expected array)');
    products = json.map(p => ({
      ...p,
      category: p.category || 'Uncategorized',
      categorySlug: slug(p.category || 'Uncategorized'),
      images: Array.isArray(p.images) ? p.images.filter(Boolean) : (p.image ? [p.image] : [])
    }));
    console.log('Loaded products:', products.length);
  }

  const slug = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

  // ---------- Card & Grid ----------
  function logoHTML(p){
    if (p.logo) return `<div class="logo-badge"><img alt="" src="${esc(p.logo)}" loading="lazy" onerror="this.style.display='none'"></div>`;
    return `<div class="logo-badge"><span class="logo-fallback">${esc(initials(p.name))}</span></div>`;
  }

  function cardHTML(p){
    const imgs = p.images.length ? p.images : [];
    const img  = imgs[0];
    const multi = imgs.length > 1 ? `<span class="multi-badge" title="${imgs.length} images">${imgs.length}×</span>` : '';
    return `<article class="card">
      <a href="#/product/${encodeURIComponent(p.id)}" aria-label="${esc(p.name)}">
        <div class="imgwrap">
          ${img ? `<img alt="${esc(p.name)}" src="${esc(img)}" loading="lazy">`
                : `<div class="badge">No image</div>`}
          ${multi}
          ${logoHTML(p)}
        </div>
      </a>
      <div class="body">
        <div><a class="chip" href="#/category/${esc(p.categorySlug)}">${esc(p.category)}</a></div>
        <h3><a href="#/product/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
        <div class="price">${fmt.format(p.price||0)}</div>
        ${p.sku ? `<div class="sku">${esc(p.sku)}</div>`:''}
        <div class="desc">${esc(p.description||'')}</div>
      </div>
      <div class="actions">
        <button data-add="${esc(p.id)}">Add</button>
        ${p.payment_url
          ? `<a class="primary btn-link" href="${esc(p.payment_url)}" target="_blank" rel="noopener">Buy</a>`
          : `<button class="primary" data-buy="${esc(p.id)}">Buy</button>`}
      </div>
    </article>`;
  }

  function renderCardsInto(el, items){
    if (!el) return;
    try{
      el.innerHTML = (items||[]).map(p=>{
        try { return cardHTML(p); } catch(e){ console.error('Card error', p?.id, e); return ''; }
      }).join('') || `<p class="hint" style="padding:16px">No products.</p>`;
    }catch(e){
      console.error('Grid render failed:', e);
      el.innerHTML = `<p class="hint" style="padding:16px">Something went wrong rendering products.</p>`;
    }
  }

  // ---------- Sidebar / Filters ----------
  function uniqueCategories(){
    const set = new Map();
    for (const p of products){
      const key = p.category || 'Uncategorized';
      set.set(key, (set.get(key)||0) + 1);
    }
    return [...set.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  }

  function applyFilters(){
    let list = products.slice();

    // search
    if (view.q){
      const q = view.q.toLowerCase();
      list = list.filter(p =>
        (p.name||'').toLowerCase().includes(q) ||
        (p.sku||'').toLowerCase().includes(q) ||
        (p.category||'').toLowerCase().includes(q) ||
        (p.description||'').toLowerCase().includes(q)
      );
    }

    // category
    if (view.cat){
      list = list.filter(p => p.categorySlug === view.cat);
    }

    // sort
    switch (view.sort){
      case 'price-asc':  list.sort((a,b)=>(a.price||0)-(b.price||0)); break;
      case 'price-desc': list.sort((a,b)=>(b.price||0)-(a.price||0)); break;
      default:           list.sort((a,b)=>a.name.localeCompare(b.name));
    }

    return list;
  }

  // ---------- Views ----------
  function renderHome(){
    const cats = uniqueCategories();
    els.root.innerHTML = `
      <div class="layout">
        <aside class="side">
          <input id="q" class="input" placeholder="Search products…" value="${esc(view.q)}">

          <div class="side-block">
            <h4>Categories</h4>
            <div id="cats" class="chips">
              ${cats.map(([name,count])=>`
                <a class="chip ${view.cat===slug(name)?'active':''}" href="#/category/${esc(slug(name))}">
                  ${esc(name)} <span class="muted">(${count})</span>
                </a>`).join('')}
            </div>
          </div>

          <div class="side-block">
            <h4>Sort</h4>
            <select id="sort" class="input">
              <option value="featured" ${view.sort==='featured'?'selected':''}>Featured</option>
              <option value="price-asc" ${view.sort==='price-asc'?'selected':''}>Price: Low → High</option>
              <option value="price-desc" ${view.sort==='price-desc'?'selected':''}>Price: High → Low</option>
            </select>
          </div>
        </aside>

        <main class="main">
          <h2>All Products</h2>
          <div id="grid" class="grid"></div>
        </main>
      </div>
    `;

    document.getElementById('q').oninput = e => { view.q = e.target.value || ''; updateGrid(); };
    document.getElementById('sort').onchange = e => { view.sort = e.target.value; updateGrid(); };

    updateGrid();
  }

  function updateGrid(){
    const list = applyFilters();
    renderCardsInto(document.getElementById('grid'), list);
    wireCardButtons();
  }

  function renderProduct({id}){
    const p = products.find(x => String(x.id) === String(id));
    if (!p){ els.root.innerHTML = `<div style="padding:16px">Product not found.</div>`; return; }

    const gallery = p.images.length ? p.images : [];
    els.root.innerHTML = `
      <div class="product-page">
        <div class="gallery">
          <div class="gallery-main">
            ${gallery.length ? `<img id="gMain" src="${esc(gallery[0])}" alt="${esc(p.name)}" loading="eager">`
                              : `<div class="badge">No image</div>`}
            ${logoHTML(p)}
          </div>
          ${gallery.length>1 ? `
          <div class="variant-picker" id="variantPicker" role="tablist" aria-label="Variants">
            ${gallery.map((u,i)=>`
              <button class="variant ${i===0?'active':''}" data-i="${i}" role="tab" aria-selected="${i===0?'true':'false'}">
                <img src="${esc(u)}" alt="Variant ${i+1}">
              </button>`).join('')}
          </div>`:''}
        </div>

        <div class="body" style="padding:16px">
          <a class="chip" href="#/category/${p.categorySlug}">${esc(p.category)}</a>
          <h2 style="margin:8px 0 6px">${esc(p.name)}</h2>
          <div class="price" style="font-size:1.25rem">${fmt.format(p.price||0)}</div>
          ${p.sku ? `<div class="sku">${esc(p.sku)}</div>`:''}
          <p class="desc">${esc(p.description||'')}</p>
          <div class="actions">
            <button data-add="${p.id}">Add to cart</button>
            ${p.payment_url ? `<a class="primary btn-link" href="${esc(p.payment_url)}" target="_blank" rel="noopener">Buy now</a>`
                            : `<button class="primary" data-buy="${p.id}">Buy now</button>`}
          </div>
          <div style="margin-top:10px"><a href="#/">← Back to products</a></div>
        </div>
      </div>
    `;

    const main = document.getElementById('gMain');
    const picker = document.getElementById('variantPicker');
    if (main && picker){
      picker.querySelectorAll('.variant').forEach(btn=>{
        btn.onclick = ()=>{
          const i = parseInt(btn.dataset.i, 10) || 0;
          main.src = gallery[i];
          picker.querySelectorAll('.variant').forEach(b=>{
            const active = (b===btn);
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
          });
        };
      });
    }

    wireCardButtons();
  }

  // ---------- Routing ----------
  function parseRoute(){
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return { page:'home' };
    const [p, a] = h.split('/');
    if (p==='product' && a) return { page:'product', id: decodeURIComponent(a) };
    if (p==='category' && a) { view.cat = a; return { page:'home' }; }
    return { page:'home' };
  }

  function navigate(){
    const r = parseRoute();
    try{
      if (r.page==='product'){ renderProduct({ id: r.id }); }
      else { renderHome(); }
    }catch(e){
      console.error('Render failed:', e);
      els.root.innerHTML = `<div style="padding:16px">Something went wrong.</div>`;
    }
  }
  window.addEventListener('hashchange', navigate);

  // ---------- Actions (cart buttons etc.) ----------
  function wireCardButtons(){
    document.querySelectorAll('[data-add]').forEach(btn=>{
      btn.onclick = ()=> alert('Added to cart (placeholder)');
    });
    document.querySelectorAll('[data-buy]').forEach(btn=>{
      btn.onclick = ()=> alert('No payment link on this item. (Placeholder)');
    });
  }

  // ---------- Start ----------
  (async function start(){
    try{
      await loadProducts();
      navigate();
    }catch(e){
      console.error(e);
      els.root.innerHTML = `<div style="padding:16px"><h3>Could not load products.</h3><p>${esc(e.message||e)}</p><p><a href="${DATA_URL}" target="_blank" rel="noopener">Open products.json</a></p></div>`;
    }
  })();

})();