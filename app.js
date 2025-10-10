// app.js — products + settings (background, multiplier, admin)
(() => {
  'use strict';

  // Helpers
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const initials = s => (s||'').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase() || 'C';
  const slug = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  const fmtUSD = v => new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(v||0);

  const els = { root: document.getElementById('app') || document.body };
  const PROD_URL = './data/products.json?ts=' + Date.now();
  const SET_URL  = './data/settings.json?ts=' + Date.now();

  // State
  let products = [];
  let settings = {
    hero_title: '',
    hero_subtitle: '',
    background_url: '',
    theme: '',
    price_multiplier: 1,
    primary_color: '',
    notion_settings_url: ''
  };
  let view = { q:'', cat:'', sort:'featured' };

  // Data
  async function loadJSON(u){ const r = await fetch(u, {cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

  async function loadAll(){
    // settings first so theme/bg apply even if products fail
    try {
      const s = await loadJSON(SET_URL);
      settings = { ...settings, ...(s||{}) };
      applySettings();
    } catch(e){
      console.warn('Settings missing (ok for first run):', e.message||e);
    }

    const raw = await loadJSON(PROD_URL);
    products = (raw||[]).map(p => ({
      ...p,
      category: p.category || 'Uncategorized',
      categorySlug: slug(p.category || 'Uncategorized'),
      images: Array.isArray(p.images)&&p.images.length ? p.images : (p.image ? [p.image] : [])
    }));
  }

  function applySettings(){
    // theme hint
    if (settings.theme === 'light') document.documentElement.classList.add('light');
    if (settings.theme === 'dark')  document.documentElement.classList.remove('light');

    // primary color (optional)
    if (settings.primary_color){
      document.documentElement.style.setProperty('--brand', settings.primary_color);
    }

    // background hero
    if (settings.background_url){
      document.documentElement.style.setProperty('--hero-url', `url("${settings.background_url}")`);
      document.documentElement.classList.add('has-hero');
    } else {
      document.documentElement.classList.remove('has-hero');
      document.documentElement.style.removeProperty('--hero-url');
    }
  }

  // Cart
  const CART_KEY='storefront_cart';
  const readCart=()=>{ try{return JSON.parse(localStorage.getItem(CART_KEY)||'[]');}catch{return[];} };
  const writeCart=items=>{ localStorage.setItem(CART_KEY, JSON.stringify(items||[])); updateCartUI(); };
  const addToCart=id=>{ const items=readCart(); items.push(String(id)); writeCart(items); };
  const cartCount=()=> readCart().length;
  const updateCartUI=()=>{ const el=document.getElementById('cartCount'); if(el) el.textContent=String(cartCount()); };

  // Derived
  function uniqueCategoriesWithHero(){
    const map=new Map();
    for(const p of products){
      const name=p.category||'Uncategorized';
      const entry=map.get(name)||{count:0,slug:slug(name),hero:''};
      entry.count++; if(!entry.hero && p.images?.[0]) entry.hero=p.images[0];
      map.set(name,entry);
    }
    return [...map.entries()].map(([name,meta])=>({name,...meta})).sort((a,b)=>a.name.localeCompare(b.name));
  }

  // UI helpers
  function logoHTML(p){
    if (p.logo) return `<div class="logo-badge"><img src="${esc(p.logo)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
    return `<div class="logo-badge"><span class="logo-fallback">${esc(initials(p.name))}</span></div>`;
  }

  function cardHTML(p){
    const imgs = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
    const img  = imgs[0];
    const multi = imgs.length>1 ? `<span class="multi-badge" title="${imgs.length} images">${imgs.length}×</span>` : '';
    const price = fmtUSD((p.price||0) * (Number(settings.price_multiplier)||1));

    return `
    <article class="card">
      <a href="#/product/${encodeURIComponent(p.id)}">
        <div class="imgwrap">
          ${img ? `<img alt="${esc(p.name)}" src="${esc(img)}" loading="lazy">` : `<div class="badge">No image</div>`}
          ${multi}
          ${logoHTML(p)}
        </div>
      </a>
      <div class="body">
        <div><a class="chip" href="#/category/${esc(p.categorySlug)}">${esc(p.category)}</a></div>
        <h3><a href="#/product/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
        <div class="price">${price}</div>
        ${p.sku ? `<div class="sku">${esc(p.sku)}</div>` : ``}
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
    el.innerHTML = (items||[]).map(cardHTML).join('') || `<p class="hint" style="padding:16px">No products.</p>`;
  }

  // VIEWS
  function renderHero(){
    if (!document.documentElement.classList.contains('has-hero')) return '';
    const title = esc(settings.hero_title || '');
    const sub   = esc(settings.hero_subtitle || '');
    if (!title && !sub) return '';
    return `
      <section class="hero">
        <div class="hero__overlay">
          ${title ? `<h1 class="hero__title">${title}</h1>` : ``}
          ${sub   ? `<p class="hero__sub">${sub}</p>` : ``}
        </div>
      </section>
    `;
  }

  function renderHome(){
    els.root.innerHTML = `
      ${renderHero()}
      <main class="main">
        <div class="toolbar">
          <div class="toolbar-left">
            <input id="q" class="input" placeholder="Search products…" value="${esc(view.q)}">
          </div>
          <div class="toolbar-right">
            ${view.cat ? `<a class="clear-chip" id="clearCat" href="#/">✕ Clear filter</a>` : ``}
            <select id="sort" class="input" style="max-width:220px">
              <option value="featured" ${view.sort==='featured'?'selected':''}>Featured</option>
              <option value="price-asc" ${view.sort==='price-asc'?'selected':''}>Price: Low → High</option>
              <option value="price-desc" ${view.sort==='price-desc'?'selected':''}>Price: High → Low</option>
            </select>
          </div>
        </div>

        <h2>All Products</h2>
        <div id="grid" class="grid"></div>
      </main>
    `;
    document.getElementById('q').oninput = e => { view.q = e.target.value || ''; updateGrid(); };
    document.getElementById('sort').onchange = e => { view.sort = e.target.value; updateGrid(); };
    const clear = document.getElementById('clearCat');
    if (clear){ clear.onclick = (ev)=>{ ev.preventDefault(); view.cat=''; location.hash='#/'; }; }
    updateGrid();
  }

  function updateGrid(){
    let list = products.slice();
    if (view.q){
      const q = view.q.toLowerCase();
      list = list.filter(p =>
        (p.name||'').toLowerCase().includes(q) ||
        (p.sku||'').toLowerCase().includes(q) ||
        (p.category||'').toLowerCase().includes(q) ||
        (p.description||'').toLowerCase().includes(q)
      );
    }
    if (view.cat) list = list.filter(p => p.categorySlug === view.cat);
    switch (view.sort){
      case 'price-asc':  list.sort((a,b)=>(a.price||0)-(b.price||0)); break;
      case 'price-desc': list.sort((a,b)=>(b.price||0)-(a.price||0)); break;
      default:           list.sort((a,b)=>a.name.localeCompare(b.name));
    }
    renderCardsInto(document.getElementById('grid'), list);
    wireCardButtons();
  }

  function renderCategories(){
    const cats = uniqueCategoriesWithHero();
    els.root.innerHTML = `
      ${renderHero()}
      <main class="main">
        <h2>Categories</h2>
        <div class="cat-grid">
          ${cats.map(c=>`
            <a class="cat-card" href="#/category/${esc(c.slug)}" aria-label="${esc(c.name)}">
              ${c.hero ? `<img class="cat-hero" src="${esc(c.hero)}" alt="${esc(c.name)}">`
                        : `<div class="cat-hero" style="display:flex;align-items:center;justify-content:center;background:#121821;color:#9fb0c2">No image</div>`}
              <div class="cat-overlay">
                <h3>${esc(c.name)}</h3>
                <span class="cat-count">(${c.count})</span>
              </div>
            </a>`).join('')}
        </div>
      </main>
    `;
  }

  function renderProduct({ id }){
    const p = products.find(x => String(x.id) === String(id));
    if (!p){ els.root.innerHTML = `<div style="padding:16px">Product not found.</div>`; return; }
    const gallery = p.images || [];
    const price = fmtUSD((p.price||0) * (Number(settings.price_multiplier)||1));

    els.root.innerHTML = `
      ${renderHero()}
      <div class="product-page">
        <div class="gallery">
          <div class="gallery-main">
            ${gallery.length ? `<img id="gMain" src="${esc(gallery[0])}" alt="${esc(p.name)}" loading="eager">`
                              : `<div class="badge">No image</div>`}
            ${logoHTML(p)}
          </div>

          ${gallery.length > 1 ? `
          <div class="variant-picker" id="variantPicker" role="tablist" aria-label="Variants">
            ${gallery.map((u,i)=>`
              <button class="variant ${i===0?'active':''}" data-i="${i}" role="tab" aria-selected="${i===0?'true':'false'}">
                <img src="${esc(u)}" alt="Variant ${i+1}">
              </button>`).join('')}
          </div>` : ``}
        </div>

        <div class="body" style="padding:16px">
          <a class="chip" href="#/category/${p.categorySlug}">${esc(p.category)}</a>
          <h2 style="margin:8px 0 6px; text-align:center">${esc(p.name)}</h2>
          <div class="price" style="font-size:1.25rem; text-align:center">${price}</div>
          ${p.sku ? `<div class="sku" style="text-align:center">${esc(p.sku)}</div>` : ``}
          <p class="desc">${esc(p.description||'')}</p>
          <div class="actions" style="justify-content:center">
            <button data-add="${p.id}">Add to cart</button>
            ${p.payment_url
              ? `<a class="primary btn-link" href="${esc(p.payment_url)}" target="_blank" rel="noopener">Buy now</a>`
              : `<button class="primary" data-buy="${p.id}">Buy now</button>`}
          </div>
          <div style="margin-top:10px; text-align:center"><a href="#/">← Back to products</a></div>
        </div>
      </div>
    `;

    const picker = document.getElementById('variantPicker');
    const main = document.getElementById('gMain');
    if (picker && main){
      picker.querySelectorAll('.variant').forEach(btn=>{
        btn.onclick = ()=>{
          const i = parseInt(btn.dataset.i,10)||0;
          if (gallery[i]) main.src = gallery[i];
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

  function renderAdmin(){
    els.root.innerHTML = `
      <main class="main">
        <h2>Admin</h2>
        <p>All settings come from your Notion <em>Store Settings</em> database.</p>
        <ul>
          <li><strong>Hero Title:</strong> ${esc(settings.hero_title||'')}</li>
          <li><strong>Hero Subtitle:</strong> ${esc(settings.hero_subtitle||'')}</li>
          <li><strong>Background URL:</strong> ${settings.background_url ? `<a href="${esc(settings.background_url)}" target="_blank" rel="noopener">open</a>` : '—'}</li>
          <li><strong>Theme:</strong> ${esc(settings.theme||'')}</li>
          <li><strong>Price Multiplier:</strong> ${Number(settings.price_multiplier||1)}</li>
          <li><strong>Primary Color:</strong> ${esc(settings.primary_color||'')}</li>
        </ul>
        ${settings.notion_settings_url ? `<p><a class="btn" href="${esc(settings.notion_settings_url)}" target="_blank" rel="noopener">Open Notion Settings</a></p>`:''}
        <p><a class="btn" href="#/">← Back</a></p>
      </main>
    `;
  }

  // Routing
  function parseRoute(){
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return { page:'home' };
    const [p, a] = h.split('/');
    if (p==='product' && a)  return { page:'product', id: decodeURIComponent(a) };
    if (p==='category' && a){ view.cat = a; return { page:'home' }; }
    if (p==='categories')    return { page:'categories' };
    if (p==='admin')         return { page:'admin' };
    return { page:'home' };
  }
  function navigate(){
    const r=parseRoute();
    if (r.page==='product') renderProduct({id:r.id});
    else if (r.page==='categories') renderCategories();
    else if (r.page==='admin') renderAdmin();
    else renderHome();
  }
  window.addEventListener('hashchange', navigate);

  // Wiring
  function wireCardButtons(){
    document.querySelectorAll('[data-add]').forEach(btn=>{ btn.onclick = ()=> addToCart(btn.getAttribute('data-add')); });
    document.getElementById('themeBtn')?.addEventListener('click', ()=> {
      document.documentElement.classList.toggle('light');
    });
    updateCartUI();
  }

  // Start
  (async function(){
    try {
      await loadAll();
      navigate();
      updateCartUI();
    } catch(e){
      console.error(e);
      els.root.innerHTML = `<div style="padding:16px"><h3>Could not load data.</h3><p>${esc(e.message||e)}</p></div>`;
    }
  })();

})();