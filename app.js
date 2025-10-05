(function(){
  const S = window.STORE || {};
  const fmt = new Intl.NumberFormat(undefined, {style:'currency', currency:S.CURRENCY||'USD'});

  const els = {
    brand: document.getElementById('brand'),
    products: document.getElementById('products'),
    search: document.getElementById('searchInput'),
    category: document.getElementById('categorySelect'),
    sort: document.getElementById('sortSelect'),
    cartBtn: document.getElementById('cartBtn'),
    cartDrawer: document.getElementById('cartDrawer'),
    closeCart: document.getElementById('closeCart'),
    cartItems: document.getElementById('cartItems'),
    subtotal: document.getElementById('subtotal'),
    cartCount: document.getElementById('cartCount'),
    checkoutBtn: document.getElementById('checkoutBtn'),
    copySummary: document.getElementById('copySummary'),
    downloadCsv: document.getElementById('downloadCsv')
  };

  let products = [];
  let cart = loadCart();

  init();
  async function init(){
    els.brand.textContent = S.NAME || "Storefront";
    attachEvents();
    await loadProducts();
    renderProducts();
    updateCartUI();
  }

  function attachEvents(){
    els.cartBtn.addEventListener('click', ()=> openCart(true));
    els.closeCart.addEventListener('click', ()=> openCart(false));
    els.search.addEventListener('input', renderProducts);
    els.category.addEventListener('change', renderProducts);
    els.sort.addEventListener('change', renderProducts);
    els.checkoutBtn.addEventListener('click', checkout);
    els.copySummary.addEventListener('click', copySummary);
    els.downloadCsv.addEventListener('click', downloadCsv);
  }

  async function loadProducts(){
    const url = S.PRODUCTS_JSON || 'data/products.json';
    try{
      const res = await fetch(url, {cache:'no-store'});
      if(!res.ok) throw new Error(res.status + ' ' + res.statusText);
      products = (await res.json()).filter(p=>p.active!==false);
      hydrateCategories();
    }catch(e){
      console.error('Failed to load products', e);
      // fallback to sample
      const res = await fetch('data/products.sample.json');
      products = await res.json();
      hydrateCategories();
    }
  }

  function hydrateCategories(){
    const cats = [...new Set(products.map(p=>p.category).filter(Boolean))];
    els.category.innerHTML = '<option value="">All categories</option>' + cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }

  function renderProducts(){
    const q = (els.search.value||'').toLowerCase().trim();
    const cat = els.category.value;
    const sort = els.sort.value;

    let list = products.filter(p => {
      const hay = (p.name + ' ' + (p.description||'') + ' ' + (p.sku||'') + ' ' + (p.category||'')).toLowerCase();
      const matchesQ = !q || hay.includes(q);
      const matchesCat = !cat || p.category===cat;
      return matchesQ && matchesCat;
    });

    list.sort((a,b)=>{
      switch(sort){
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'price-asc': return (a.price??0)-(b.price??0);
        case 'price-desc': return (b.price??0)-(a.price??0);
        default: return 0;
      }
    });

    els.products.innerHTML = list.map(cardHTML).join('');
    // wire buttons
    document.querySelectorAll('[data-add]').forEach(btn=>{
      btn.addEventListener('click', ()=> addToCart(btn.dataset.add, 1));
    });
    document.querySelectorAll('[data-buy]').forEach(btn=>{
      btn.addEventListener('click', ()=> buyNow(btn.dataset.buy));
    });
  }

  function cardHTML(p){
    const price = p.price!=null ? `<div class="price">${fmt.format(p.price)}</div>` : '<span class="badge">Ask for price</span>';
    const sku = p.sku ? `<div class="sku">${escapeHtml(p.sku)}</div>` : '';
    const img = p.image ? `<img alt="${escapeHtml(p.name)}" src="${escapeHtml(p.image)}">` : `<div class="badge">No Image</div>`;
    return `<article class="card">
      <div class="imgwrap">${img}</div>
      <div class="body">
        <h3>${escapeHtml(p.name)}</h3>
        ${price}
        ${sku}
        <div class="desc">${escapeHtml(p.description||'')}</div>
      </div>
      <div class="actions">
        <button data-add="${p.id}">Add</button>
        <button class="primary" data-buy="${p.id}">Buy</button>
      </div>
    </article>`;
  }

  function addToCart(id, qty){
    const p = products.find(x=>String(x.id)===String(id));
    if(!p) return;
    const i = cart.items.findIndex(it=>it.id===p.id);
    if(i>=0){ cart.items[i].qty += qty; }
    else { cart.items.push({id:p.id, name:p.name, price:p.price||0, sku:p.sku||'', image:p.image||'', qty}); }
    persistCart();
    updateCartUI();
    openCart(true);
  }

  function buyNow(id){
    const p = products.find(x=>String(x.id)===String(id));
    if(!p) return;
    if(S.CHECKOUT_MODE==='links' && p.payment_url){
      window.open(p.payment_url, '_blank');
      return;
    }
    // default to add & open cart
    addToCart(id,1);
  }

  function openCart(state){
    els.cartDrawer.classList.toggle('open', !!state);
    els.cartDrawer.setAttribute('aria-hidden', state? 'false':'true');
  }

  function updateCartUI(){
    const items = cart.items;
    els.cartItems.innerHTML = items.length? items.map(itemHTML).join('') : '<p>Your cart is empty.</p>';
    document.querySelectorAll('[data-inc]').forEach(btn=>btn.addEventListener('click', ()=> changeQty(btn.dataset.inc, +1)));
    document.querySelectorAll('[data-dec]').forEach(btn=>btn.addEventListener('click', ()=> changeQty(btn.dataset.dec, -1)));
    document.querySelectorAll('[data-del]').forEach(btn=>btn.addEventListener('click', ()=> removeItem(btn.dataset.del)));
    const subtotal = items.reduce((s,it)=> s + (it.price||0)*it.qty, 0);
    els.subtotal.textContent = fmt.format(subtotal);
    els.cartCount.textContent = items.reduce((s,it)=>s+it.qty,0);
  }

  function itemHTML(it){
    return `<div class="item">
      ${it.image? `<img alt="" src="${escapeHtml(it.image)}">` : '<div></div>'}
      <div>
        <div><strong>${escapeHtml(it.name)}</strong></div>
        <div class="sku">${escapeHtml(it.sku||'')}</div>
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

  function changeQty(id, delta){
    const it = cart.items.find(x=>String(x.id)===String(id));
    if(!it) return;
    it.qty += delta;
    if(it.qty<=0){ cart.items = cart.items.filter(x=>x!==it); }
    persistCart();
    updateCartUI();
  }

  function removeItem(id){
    cart.items = cart.items.filter(x=>String(x.id)!==String(id));
    persistCart(); updateCartUI();
  }

  function checkout(){
    if(!cart.items.length){ alert('Cart is empty.'); return; }
    if(S.CHECKOUT_MODE==='links'){
      // open first item's link as a simple demo
      const first = cart.items[0];
      const p = products.find(x=>x.id===first.id);
      if(p && p.payment_url){ window.open(p.payment_url, '_blank'); return; }
    }
    // Default email checkout
    const subject = encodeURIComponent(`${S.NAME||'Storefront'} Order`);
    const body = encodeURIComponent(orderText());
    const mailto = `mailto:${encodeURIComponent(S.ORDER_EMAIL||'orders@example.com')}?subject=${subject}&body=${body}`;
    window.location.href = mailto;
  }

  function orderText(){
    const lines = [];
    lines.push(`Order for ${S.NAME||'Storefront'}`);
    lines.push(`Date: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('Items:');
    cart.items.forEach(it=>{
      lines.push(`- ${it.name} (${it.sku||'no sku'}) x ${it.qty} @ ${fmt.format(it.price||0)} = ${fmt.format((it.price||0)*it.qty)}`);
    });
    const subtotal = cart.items.reduce((s,it)=> s + (it.price||0)*it.qty, 0);
    lines.push('');
    lines.push(`Subtotal: ${fmt.format(subtotal)}`);
    lines.push('');
    lines.push('Customer info:');
    lines.push('Name: ');
    lines.push('Email: ');
    lines.push('Phone: ');
    lines.push('Address: ');
    return lines.join('\n');
  }

  function copySummary(){
    const t = orderText();
    navigator.clipboard.writeText(t).then(()=>{
      alert('Order summary copied.');
    });
  }

  function downloadCsv(){
    if(!cart.items.length){ alert('Cart is empty.'); return; }
    const rows = [['Name','SKU','Qty','Unit Price','Line Total']];
    cart.items.forEach(it=> rows.push([it.name, it.sku||'', it.qty, (it.price||0), (it.price||0)*it.qty]));
    const csv = rows.map(r=> r.map(v=> `"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'order.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadCart(){
    try{
      return JSON.parse(localStorage.getItem('cart_v1')||'{"items":[]}');
    }catch{ return {items:[]}}
  }
  function persistCart(){
    localStorage.setItem('cart_v1', JSON.stringify(cart));
  }

  function escapeHtml(s){
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  }
})();
