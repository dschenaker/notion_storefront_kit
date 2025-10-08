function renderProduct({id}){
  const p = products.find(x=>String(x.id)===String(id));
  if (!p){ els.root.innerHTML = `<p class="hint" style="padding:16px">Product not found.</p>`; return; }

  // gather images: gallery first, else single image
  const gallery = (Array.isArray(p.images) && p.images.length ? p.images
                  : (p.image ? [p.image] : [])).filter(Boolean);

function cardHTML(p){
  const imgs = (Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []));
  const img  = imgs[0];
  const multi = imgs.length > 1 ? `<span class="multi-badge" title="${imgs.length} images">${imgs.length}×</span>` : '';
  // ... your existing markup ...
  return `<article class="card">
      <a href="#/product/${encodeURIComponent(p.id)}">
        <div class="imgwrap">
          ${img ? `<img alt="${esc(p.name)}" src="${esc(img)}" loading="lazy">` : `<div class="badge">No image</div>`}
          ${multi}
          ${logoHTML(p)}
        </div>
      </a>
      <!-- rest unchanged -->
  `;
}

  // render
  els.root.innerHTML = `
    <div class="product-page">
      <div class="gallery">
        <div class="gallery-main">
          ${gallery.length ? `<img id="gMain" src="${esc(gallery[0])}" alt="${esc(p.name)}" loading="eager">`
                           : `<div class="badge">No image</div>`}
          ${p.logo ? `<div class="logo-badge"><img alt="" src="${esc(p.logo)}" loading="lazy"
             onerror="this.replaceWith(createLogoFallback('${esc(initials(p.name))}'))"></div>`
                   : `<div class="logo-badge"><span class="logo-fallback">${esc(initials(p.name))}</span></div>`}
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
        <a class="chip" href="#/category/${p.categorySlug}">${esc(p.category || 'Uncategorized')}</a>
        <h2 style="margin:8px 0 6px">${esc(p.name)}</h2>
        <div class="price" style="font-size:1.25rem">${fmt.format(p.price||0)}</div>
        ${p.sku ? `<div class="sku">${esc(p.sku)}</div>` : ``}
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

  // wire variant buttons to swap the main image
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

  // cart / buy
  wireCardButtons();
}