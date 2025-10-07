(function(){
  const S = window.STORE || {};
  const fmt = new Intl.NumberFormat(undefined, { style:'currency', currency:S.CURRENCY||'USD' });

  // DOM
  const els = {
    brand: byId('brand'),
    root: byId('routeRoot'),
    search: byId('searchInput'),
    sort: byId('sortSelect'),
    catList: byId('categoryList'),
    cartBtn: byId('cartBtn'),
    cartDrawer: byId('cartDrawer'),
    closeCart: byId('closeCart'),
    cartItems: byId('cartItems'),
    subtotal: byId('subtotal'),
    cartCount: byId('cartCount'),
    checkoutBtn: byId('checkoutBtn'),
    copySummary: byId('copySummary'),
    downloadCsv: byId('downloadCsv'),
    lastSynced: byId('lastSynced'),
    themeToggle: byId('themeToggle'),
    syncBtn: byId('syncBtn')
  };

  let products = [];
  let categories = [];
  let cart = loadCart();

  // Router
  const routes = {
    '/': renderShop,
    '/category/:slug': renderShop,
    '/product/:id': renderProduct,
    '/brands': renderBrands,
    '/about': renderAbout,
    '/contact': renderContact
  };

  // Init
  els.brand.textContent = S.NAME || "Storefront";
  restoreTheme();
  attachGlobalEvents();
  skeletonGrid();
  loadProducts().then(()=> navigate(location.hash || '#/'));
  window.addEventListener('hashchange', ()=> navigate(location.hash));

  // ---------- Core ----------
  async function loadProducts(){
    const url = S.PRODUCTS_JSON || 'data/products.json';
    try{
      const res = await fetch(url, { cache:'no-store' });
      if(!res.ok) throw new Error(res.status + ' ' + res.statusText);
      const json = await res.json();
      products = json.filter(p=>p && p.name && p.active!==false).map(normalizeProduct);
      categories = buildCategories(products);
      renderCategoryChips(categories);
      els.lastSynced.textContent = `Last synced: ${new Date().toLocaleString()}`;
    }catch(e){
      console.error('Failed to load products', e);
      els.root.innerHTML = `<p class="hint" style="padding:16px">Could not load products.</p>`;
    }
  }

  function normalizeProduct(p){
    return {
      id: String(p.id || p.sku || cryptoRandom()),
      name: String(p.name),
      sku: p.sku || '',
      price: Number(p.price||0),
      image: resolveMedia(p.image),
      logo: resolveMedia(p.logo),
      category: (p.category||'Uncategorized').trim(),
      categorySlug: slug(p.category||'Uncategorized'),
      description: p.description||'',
      payment_url: p.payment_url || ''
    };
  }

  function buildCategories(list){
    const set = new Map();
    list.forEach(p=>{
      const key = p.categorySlug;
      const entry = set.get(key) || { name:p.category, slug:key, count:0 };
      entry.count += 1; set.set(key, entry);
    });
    return Array.from(set.values()).sort((a,b)=> a.name.localeCompare(b.name));
  }

  function resolveMedia(m){
    if(!m) return '';
    if (Array.isArray(m)) m = m[0];
    if (typeof m !== 'string') return '';
    if (/amazonaws\.com|notion-static|notion\.so/.test(m)) {
      const sep = m.includes('?') ? '&' : '?';
      return `${m}${sep}t=${Date.now().toString().slice(-6)}`;
    }
    return m;
  }

  // ---------- Router ----------
  function navigate(hash){
    const path = (hash||'#/').replace(/^#/, '');
    for (const pattern in routes){
      const {match, params} = matchRoute(pattern, path);
      if (match){ routes[pattern](params); return; }
    }
    routes['/']({});
  }
  function matchRoute(pattern, path){
    const p = pattern.split('/').filter(Boolean);
    const a = path.split('/').filter(Boolean);
    if (p.length !== a.length) return {match:false};
    const params = {};
    for(let i=0;i<p.length;i++){
      if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
      else if (p[i] !== a[i]) return {match:false};
    }
    return {match:true, params};
  }

  // ---------- Views ----------
  function renderShop(params={}){
    const activeCat = params.slug || '';
    els.search.oninput = () => renderShop(params);
    els.sort.onchange = () => renderShop(params);

    const q = (els.search.value||'').toLowerCase().trim();
    const sort = els.sort.value;

    let list = products.filter(p=>{
      const hay = (p.name + ' ' + p.description + ' ' + p.sku + ' ' + p.category).toLowerCase();
      const matchesQ = !q || hay.includes(q);
      const matchesCat = !activeCat || p.categorySlug === activeCat;
      return matchesQ && matchesCat;
    });

    list.sort((a,b)=>{
      switch(sort){
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'price-asc': return (a.price||0)-(b.price||0);
        case 'price-desc': return (b.price||0)-(a.price||0);
        default: return 0;
      }
    });

    const header = activeCat ? 
      `<div class="pagehead" style="padding:16px"><h2>${unSlug(activeCat)}</h2><a class="chip" href="#/">Clear</a></div>` 
      : `<div class="pagehead" style="padding:16px"><h2>All Products</h2></div>`;

    const grid = list.length ? list.map(cardHTML).join('') : `<p class="hint" style="padding:16px">No products found.</p>`;
    els.root.innerHTML = header + `<div class="grid">${grid}</div>`;
    wireCardButtons();
  }

  function renderProduct({id}){
  const p = products.find(x=>String(x.id)===String(id));
  if (!p){ els.root.innerHTML = `<p class="hint" style="padding:16px">Product not found.</p>`; return; }

  const imgs = (Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []))
               .filter(Boolean);

  els.root.innerHTML = `
    <div class="product-page">
      <div class="gallery">
        <div class="gallery-main">
          ${imgs.length ? `<img id="gMain" src="${esc(imgs[0])}" alt="${esc(p.name)}" loading="eager">`
                        : `<div class="badge">No image</div>`}
          ${p.logo ? `<div class="logo-badge"><img alt="" src="${esc(p.logo)}" loading="lazy"
             onerror="this.replaceWith(createLogoFallback('${esc(initials(p.name))}'))"></div>`
                   : `<div class="logo-badge"><span class="logo-fallback">${esc(initials(p.name))}</span></div>`}
          <button class="g-nav prev" id="gPrev" aria-label="Previous image">‹</button>
          <button class="g-nav next" id="gNext" aria-label="Next image">›</button>
        </div>
        ${imgs.length > 1 ? `
        <div class="gallery-thumbs" id="gThumbs">
          ${imgs.map((u,i)=>`
            <button class="thumb ${i===0?'active':''}" data-i="${i}" aria-label="Image ${i+1}">
              <img src="${esc(u)}" alt="">
            </button>`).join('')}
        </div>` : ``}
      </div>

      <div class="body" style="padding:16px">
        <a class="chip" href="#/category/${p.categorySlug}">${esc(p.category || 'Uncategorized')}</a>
        <h2 style="margin:8px 0 6px">${esc(p.name)}</h2>
        <div class="price" style="font-size:1.25rem">${fmt.format(p.price||0)}</div>
        <div class="sku">${esc(p.sku||'')}</div>
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

  // wire gallery
  initGallery(imgs);
  // wire cart/buy
  wireCardButtons();
}

  function renderBrands(){
    const groups = groupBy(products.filter(p=>p.logo), x=>x.category);
    let html = `<div class="pagehead" style="padding:16px"><h2>Brands / Logos</h2></div><div class="grid">`;
    for (const [cat, items] of Object.entries(groups)){
      html += `<article class="card"><div class="body">
        <h3>${esc(cat)}</h3>
        <div style="display:flex;flex-wrap:wrap;gap:10px">
          ${items.slice(0,24).map(p=>`
            <div class="logo-badge" title="${esc(p.name)}">
              ${p.logo ? `<img alt="" src="${esc(p.logo)}" loading="lazy" onerror="this.replaceWith(createLogoFallback('${esc(initials(p.name))}'))">` : `<span class="logo-fallback">${esc(initials(p.name))}</span>`}
            </div>`).join('')}
        </div>
      </div></article>`;
    }
    html += `</div>`;
    els.root.innerHTML = html;
  }

  function renderAbout(){
    els.root.innerHTML = `
      <div class="pagehead" style="padding:16px"><h2>About</h2></div>
      <div style="padding:16px">
        <p>This storefront is powered by Notion → JSON sync and GitHub Pages. Fast, free, and under your control.</p>
      </div>
    `;
  }

  function renderContact(){
    els.root.innerHTML = `
      <div class="pagehead" style="padding:16px"><h2>Contact / Quote</h2></div>
      <form class="form" id="contactForm">
        <div class="row">
          <label>Full name
            <input name="name" required placeholder="Jane Doe">
          </label>
          <label>Email
            <input name="email" type="email" required placeholder="jane@example.com">
          </label>
        </div>
        <div class="row">
          <label>Phone (optional)
            <input name="phone" placeholder="+1 (555) 555-5555">
          </label>
          <label>Company (optional)
            <input name="company" placeholder="Acme Inc.">
          </label>
        </div>
        <label>Message
          <textarea name="message" placeholder="Tell us what you need…"></textarea>
        </label>
        <div class="actions">
          <button type="submit" class="btn primary">Send email</button>
          <button type="button" id="attachCart" class="btn">Attach cart items</button>
        </div>
        <p class="hint" style="color:var(--muted)">A mail draft will open in your email app. We never store your info.</p>
      </form>
    `;
    const form = byId('contactForm');
    const attachBtn = byId('attachCart');
    attachBtn.onclick = () => alert('Cart items will be included automatically if present.');
    form.onsubmit = (e)=>{
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const lines = [];
      lines.push(`Name: ${data.name}`);
      lines.push(`Email: ${data.email}`);
      if (data.phone)   lines.push(`Phone: ${data.phone}`);
      if (data.company) lines.push(`Company: ${data.company}`);
      lines.push('');
      lines.push('Message:');
      lines.push(data.message||'(no message)');
      lines.push('');
      if (cart.items.length){
        lines.push('Attached cart:');
        cart.items.forEach(it=>{
          lines.push(`- ${it.name} (${it.sku||'no sku'}) x ${it.qty} @ ${fmt.format(it.price||0)} = ${fmt.format((it.price||0)*it.qty)}`);
        });
        const subtotal = cart.items.reduce((s,it)=> s + (it.price||0)*it.qty, 0);
        lines.push(`Subtotal: ${fmt.format(subtotal)}`);
      }
      const subject = encodeURIComponent(`${S.NAME||'Storefront'} — Contact / Quote`);
      const body = encodeURIComponent(lines.join('\n'));
      const mailto = `mailto:${encodeURIComponent(S.ORDER_EMAIL||'orders@example.com')}?subject=${subject}&body=${body}`;
      location.href = mailto;
    };
  }
function initGallery(imgs){
  const main = document.getElementById('gMain');
  const thumbs = document.getElementById('gThumbs');
  if (!main || !imgs || !imgs.length) return;

  let idx = 0;

  const setIdx = (i)=>{
    idx = (i + imgs.length) % imgs.length;
    main.src = imgs[idx];
    // update active thumb
    if (thumbs){
      thumbs.querySelectorAll('.thumb').forEach((b,bi)=> b.classList.toggle('active', bi===idx));
      // auto-scroll thumbs to keep active in view
      const active = thumbs.querySelector('.thumb.active');
      if (active) active.scrollIntoView({inline:'center', block:'nearest', behavior:'smooth'});
    }
  };

  // buttons
  const prev = document.getElementById('gPrev');
  const next = document.getElementById('gNext');
  if (prev) prev.onclick = ()=> setIdx(idx-1);
  if (next) next.onclick = ()=> setIdx(idx+1);

  // thumbs
  if (thumbs){
    thumbs.querySelectorAll('.thumb').forEach(b=>{
      b.onclick = ()=> setIdx(parseInt(b.dataset.i,10)||0);
    });
  }

  // keyboard
  const onKey = (e)=> {
    if (e.key === 'ArrowLeft') setIdx(idx-1);
    if (e.key === 'ArrowRight') setIdx(idx+1);
  };
  document.addEventListener('keydown', onKey, { passive:true });
  // simple swipe
  attachSwipe(document.querySelector('.gallery-main'), ()=>setIdx(idx-1), ()=>setIdx(idx+1));
}

function attachSwipe(el, onLeft, onRight){
  if (!el) return;
  let startX=0, startY=0, active=false;
  el.addEventListener('touchstart', (e)=>{
    const t=e.touches[0]; startX=t.clientX; startY=t.clientY; active=true;
  }, {passive:true});
  el.addEventListener('touchmove', (e)=>{
    if(!active) return;
    const t=e.touches[0]; const dx=t.clientX-startX; const dy=t.clientY-startY;
    if (Math.abs(dx)>30 && Math.abs(dx)>Math.abs(dy)){ e.preventDefault(); if(dx>0) onLeft(); else onRight(); active=false; }
  }, {passive:false});
  el.addEventListener('touchend', ()=>{ active=false; }, {passive:true});
}
  // ---------- UI helpers ----------
  function cardHTML(p){
  const imgs = (Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []));
  const img  = imgs[0];
  const logo = logoHTML(p);
  const price = p.price!=null ? `<div class="price">${fmt.format(p.price)}</div>` : '<span class="badge">Ask</span>';
  const sku = p.sku ? `<div class="sku">${esc(p.sku)}</div>` : '';
  const thumbs = imgs.slice(1,4).map(u=>`<span class="mini" style="background-image:url('${esc(u)}')"></span>`).join('');
  return `<article class="card">
      <a href="#/product/${encodeURIComponent(p.id)}">
        <div class="imgwrap">
          ${img ? `<img alt="${esc(p.name)}" src="${esc(img)}" loading="lazy" onerror="this.replaceWith(document.createTextNode('No image'))">`
                 : `<div class="badge">No image</div>`}
          ${logo}
        </div>
      </a>
      ${imgs.length>1 ? `<div class="mini-strip">${thumbs}</div>` : ``}
      <div class="body">
        <div><a class="chip" href="#/category/${p.categorySlug}">${esc(p.category)}</a></div>
        <h3><a href="#/product/${encodeURIComponent(p.id)}">${esc(p.name)}</a></h3>
        ${price}${sku}
        <div class="desc">${esc(p.description||'')}</div>
      </div>
      <div class="actions">
        <button data-add="${p.id}">Add</button>
        <button class="primary" data-buy="${p.id}">Buy</button>
      </div>
    </article>`;
}
  function logoHTML(p){
    if (p.logo) {
      return `<div class="logo-badge">
        <img alt="" src="${esc(p.logo)}" loading="lazy"
             onerror="this.replaceWith(createLogoFallback('${esc(initials(p.name))}'))">
      </div>`;
    }
    return `<div class="logo-badge"><span class="logo-fallback">${esc(initials(p.name))}</span></div>`;
  }

  function wireCardButtons(){
    qsa('[data-add]').forEach(b=> b.onclick = ()=> addToCart(b.dataset.add,1));
    qsa('[data-buy]').forEach(b=> b.onclick = ()=> buyNow(b.dataset.buy));
  }

  function renderCategoryChips(cats){
    els.catList.innerHTML = cats.map(c=>`<a class="chip" href="#/category/${c.slug}" data-cat="${c.slug}">${esc(c.name)} (${c.count})</a>`).join('');
    const hash = (location.hash||'').replace(/^#/, '');
    const match = matchRoute('/category/:slug', hash);
    qsa('.chip').forEach(ch=> ch.classList.toggle('active', !!(match.match && ch.getAttribute('data-cat')===match.params.slug)));
  }

  function skeletonGrid(){
    const cards = Array.from({length:6}).map(()=>`
      <div class="skel-card">
        <div class="skel-img skeleton"></div>
        <div class="skel-body">
          <div class="skeleton" style="height:16px;width:70%"></div>
          <div class="skeleton" style="height:14px;width:40%"></div>
          <div class="skeleton" style="height:14px;width:55%"></div>
        </div>
      </div>`).join('');
    els.root.innerHTML = `<div class="grid">${cards}</div>`;
  }

  // ---------- Cart ----------
  function addToCart(id, qty){
    const p = products.find(x=>String(x.id)===String(id));
    if(!p) return;
    const i = cart.items.findIndex(it=>it.id===p.id);
    if(i>=0){ cart.items[i].qty += qty; }
    else { cart.items.push({id:p.id,name:p.name,price:p.price||0,sku:p.sku||'',image:p.image||'',qty}); }
    persistCart(); updateCartUI(); openCart(true);
  }
  function buyNow(id){
    const p = products.find(x=>String(x.id)===String(id));
    if(!p) return;
    if(S.CHECKOUT_MODE==='links' && p.payment_url){ window.open(p.payment_url,'_blank'); return; }
    addToCart(id,1);
  }
  function updateCartUI(){
    const items = cart.items;
    els.cartItems.innerHTML = items.length? items.map(itemHTML).join('') : '<p style="padding:12px">Your cart is empty.</p>';
    qsa('[data-inc]').forEach(btn=>btn.onclick = ()=> changeQty(btn.dataset.inc, +1));
    qsa('[data-dec]').forEach(btn=>btn.onclick = ()=> changeQty(btn.dataset.dec, -1));
    qsa('[data-del]').forEach(btn=>btn.onclick = ()=> removeItem(btn.dataset.del));
    const subtotal = items.reduce((s,it)=> s + (it.price||0)*it.qty, 0);
    els.subtotal.textContent = fmt.format(subtotal);
    els.cartCount.textContent = items.reduce((s,it)=>s+it.qty,0);
  }
  function itemHTML(it){
    return `<div class="item">
      ${it.image? `<img alt="" src="${esc(it.image)}" loading="lazy">` : '<div></div>'}
      <div>
        <div><strong>${esc(it.name)}</strong></div>
        <div class="sku">${esc(it.sku||'')}</div>
        <div>${fmt.format(it.price||0)}</div>
        <div class="qty">
          <button data-dec="${it.id}">-</button>
          <span>${it.qty}</span>
          <button data-inc="${it.id}">+</button>
          <button data-del="${it.id}" title="Remove">🗑</button>
        </div>
      </div>
      <div style="justify-self:end">${fmt.format((it.price||0)*it.qty)}</div>
    </div>`;
  }
  function changeQty(id, d){ const it = cart.items.find(x=>String(x.id)===String(id)); if(!it)return; it.qty+=d; if(it.qty<=0) cart.items=cart.items.filter(x=>x!==it); persistCart(); updateCartUI();}
  function removeItem(id){ cart.items = cart.items.filter(x=>String(x.id)!==String(id)); persistCart(); updateCartUI(); }
  function openCart(state){ els.cartDrawer.classList.toggle('open', !!state); els.cartDrawer.setAttribute('aria-hidden', state?'false':'true'); }

  // ---------- Global controls ----------
  function attachGlobalEvents(){
    els.cartBtn.onclick = ()=> openCart(true);
    els.closeCart.onclick = ()=> openCart(false);
    els.checkoutBtn.onclick = checkout;
    els.copySummary.onclick = copySummary;
    els.downloadCsv.onclick = downloadCsv;

    // Theme toggle
    els.themeToggle.onclick = toggleTheme;

    // Sync button: opens your workflow page so you can click "Run workflow"
    els.syncBtn.onclick = ()=>{
      const url = `https://github.com/${encodeURIComponent(S.REPO_OWNER)}/${encodeURIComponent(S.REPO_NAME)}/actions/workflows/${encodeURIComponent(S.WORKFLOW_FILE)}`;
      window.open(url, '_blank');
    };
  }

  function checkout(){
    if(!cart.items.length){ alert('Cart is empty.'); return; }
    if(S.CHECKOUT_MODE==='links'){
      const first = cart.items[0]; const p = products.find(x=>x.id===first.id);
      if(p && p.payment_url){ window.open(p.payment_url,'_blank'); return; }
    }
    const subject = encodeURIComponent(`${S.NAME||'Storefront'} Order`);
    const body = encodeURIComponent(orderText());
    const mailto = `mailto:${encodeURIComponent(S.ORDER_EMAIL||'orders@example.com')}?subject=${subject}&body=${body}`;
    location.href = mailto;
  }
  function orderText(){
    const lines = [];
    lines.push(`Order for ${S.NAME||'Storefront'}`);
    lines.push(`Date: ${new Date().toLocaleString()}`,'','Items:');
    cart.items.forEach(it=> lines.push(`- ${it.name} (${it.sku||'no sku'}) x ${it.qty} @ ${fmt.format(it.price||0)} = ${fmt.format((it.price||0)*it.qty)}`));
    const subtotal = cart.items.reduce((s,it)=> s + (it.price||0)*it.qty, 0);
    lines.push(''); lines.push(`Subtotal: ${fmt.format(subtotal)}`,'','Customer info:','Name: ','Email: ','Phone: ','Address: ');
    return lines.join('\n');
  }
  function copySummary(){ navigator.clipboard.writeText(orderText()).then(()=> alert('Order summary copied.')); }
  function downloadCsv(){
    if(!cart.items.length){ alert('Cart is empty.'); return; }
    const rows = [['Name','SKU','Qty','Unit Price','Line Total']];
    cart.items.forEach(it=> rows.push([it.name, it.sku||'', it.qty, (it.price||0), (it.price||0)*it.qty]));
    const csv = rows.map(r=> r.map(v=> `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'}); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'order.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  // ---------- Theme ----------
  function restoreTheme(){
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme(){
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }

  // ---------- Utils ----------
  function loadCart(){ try{ return JSON.parse(localStorage.getItem('cart_v1')||'{"items":[]}'); }catch{ return {items:[]} } }
  function persistCart(){ localStorage.setItem('cart_v1', JSON.stringify(cart)); }
  function byId(id){ return document.getElementById(id); }
  function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
  function esc(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
  function slug(s){ return String(s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'uncategorized'; }
  function unSlug(s){ return s.split('-').map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' '); }
  function cryptoRandom(){ return Math.random().toString(36).slice(2); }
  function groupBy(arr, fn){ return arr.reduce((m,x)=>{ const k=fn(x); (m[k]=m[k]||[]).push(x); return m; },{}); }
  window.createLogoFallback = (txt)=>{ const span=document.createElement('span'); span.className='logo-fallback'; span.textContent=txt; return span; };
  function initials(name){ const parts=String(name||'').trim().split(/\s+/); return (parts[0]?.[0]||'').toUpperCase(); }
})();