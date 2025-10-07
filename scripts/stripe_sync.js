// Stripe sync: ensure Product → Price → Payment Link for each item in data/products.json
// Writes the payment_url back into products.json
// Usage (CI or local): node scripts/stripe_sync.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_CURRENCY   = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();

if (!STRIPE_SECRET_KEY) {
  console.log('ℹ️  STRIPE_SECRET_KEY not set — skipping Stripe sync. (Buy buttons will stay as-is)');
  process.exit(0);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

const PRODUCTS_JSON = path.join(__dirname, '..', 'data', 'products.json');

function loadProducts() {
  const raw = fs.readFileSync(PRODUCTS_JSON, 'utf8');
  return JSON.parse(raw);
}

function saveProducts(list) {
  fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(list, null, 2));
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64);
}

// idempotent: find product by SKU (preferred) or name
async function findOrCreateProduct({ name, sku, description, image }) {
  let product = null;

  // Prefer SKU if present
  if (sku) {
    try {
      const res = await stripe.products.search({
        // metadata search is powerful & fast
        query: `active:'true' AND metadata['sku']:'${sku.replace(/'/g, "\\'")}'`,
        limit: 1
      });
      if (res.data.length) product = res.data[0];
    } catch (e) {
      // search can be disabled on some accounts; fallback to list
    }
  }

  if (!product) {
    // Try by name (best-effort)
    const list = await stripe.products.list({ active: true, limit: 100 });
    product = list.data.find(p => p.name === name) || null;
  }

  if (!product) {
    product = await stripe.products.create({
      name,
      description: description || undefined,
      images: image ? [image] : undefined,
      metadata: { sku: sku || slugify(name) }
    });
    console.log('  [+] Created product:', product.id, '→', name);
  }
  return product;
}

// re-use existing Price with same amount/currency; else create a new one
async function findOrCreatePrice(productId, unitAmount, currency) {
  const list = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  let price = list.data.find(p => p.unit_amount === unitAmount && p.currency === currency) || null;

  if (!price) {
    price = await stripe.prices.create({
      product: productId,
      unit_amount: unitAmount,
      currency
    });
    console.log('  [+] Created price:', price.id, `${(unitAmount/100).toFixed(2)} ${currency}`);
  }
  return price;
}

// Prefer reusing a Payment Link for this price if we saved it previously in product metadata
async function findOrCreatePaymentLink(product, price) {
  const metaKey = `paylink_${price.unit_amount}_${price.currency}`;
  const cached = product.metadata && product.metadata[metaKey];
  if (cached) return cached;

  const pl = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    after_completion: { type: 'redirect', redirect: { url: 'https://dschenaker.github.io/notion_storefront_kit/' } }
  });

  // save URL back on the product so we can reuse next run
  await stripe.products.update(product.id, {
    metadata: { ...(product.metadata || {}), [metaKey]: pl.url }
  });

  console.log('  [+] Created payment link:', pl.url);
  return pl.url;
}

(async () => {
  try {
    const products = loadProducts();
    let touched = 0, created = 0;

    for (const p of products) {
      if (!p.active) continue;
      const priceNum = Number(p.price || 0);
      if (!priceNum || isNaN(priceNum)) continue;  // skip $0 items

      const unit = Math.round(priceNum * 100);
      const name = p.name;
      const sku  = p.sku || slugify(p.name);
      const desc = p.description || '';
      const img  = p.image || (Array.isArray(p.images) && p.images[0]) || '';

      console.log(`\n[Stripe] Sync "${name}" ($${priceNum.toFixed(2)}) SKU=${sku}`);

      const sp = await findOrCreateProduct({ name, sku, description: desc, image: img });
      const pr = await findOrCreatePrice(sp.id, unit, STRIPE_CURRENCY);
      const url = await findOrCreatePaymentLink(sp, pr);

      if (p.payment_url !== url) {
        p.payment_url = url;
        touched++;
      }
      created++;
    }

    if (touched) {
      saveProducts(products);
      console.log(`\n✅ Updated payment_url for ${touched} item(s) in data/products.json`);
    } else {
      console.log('\nℹ️ No changes to payment_url (already up-to-date)');
    }
    console.log(`✅ Stripe sync done for ${created} priced item(s).`);
  } catch (err) {
    console.error('❌ Stripe sync failed:', err.message || err);
    process.exit(1);
  }
})();