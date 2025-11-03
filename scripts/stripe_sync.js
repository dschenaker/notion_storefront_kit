// scripts/stripe_sync.js
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Stripe from 'stripe';

// --- Env & sanity ---
const {
  STRIPE_API_KEY,
  STRIPE_MODE = 'test',
  NOTION_TOKEN,
  NOTION_DB_ID,
} = process.env;

if (!STRIPE_API_KEY) throw new Error('Missing STRIPE_API_KEY');
if (!NOTION_TOKEN)   throw new Error('Missing NOTION_TOKEN');
if (!NOTION_DB_ID)   throw new Error('Missing NOTION_DB_ID');

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2024-06-20' });

// --- Load products.json exported from Notion sync ---
const dataPath = path.join(process.cwd(), 'data', 'products.json');
if (!fs.existsSync(dataPath)) throw new Error('products.json not found. Run notion_sync first.');
const catalog = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Helpers
const delay = (ms) => new Promise(res => setTimeout(res, ms));

const readNotion = async (page = 1) => catalog.items || catalog; // structure-agnostic

// Minimal Notion update (PaymentURL & Stripe Link (Test))
const updateNotionRow = async ({ pageId, liveUrl, testUrl }) => {
  const body = {
    properties: {}
  };

  // Keep your existing property names:
  // "PaymentURL" (live), "Stripe Link (Test)" (test)
  if (liveUrl) body.properties['PaymentURL'] = { url: liveUrl };
  if (testUrl) body.properties['Stripe Link (Test)'] = { url: testUrl };

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'patch',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Notion update failed (${res.status}): ${t}`);
  }
};

// Create or find a Stripe Product by SKU/name
const findOrCreateProduct = async ({ name, sku, description }) => {
  // Try by metadata.sku first
  const list = await stripe.products.list({ limit: 1, active: true, expand: [], url: undefined, });
  // NOTE: the above can't filter directly by metadata; we’ll try a search:
  const search = await stripe.products.search({
    query: `active:'true' AND metadata['sku']:'${sku}'`,
    limit: 1,
  }).catch(() => ({ data: [] }));

  if (search.data?.length) return search.data[0];

  // Fallback: create
  return stripe.products.create({
    name,
    description: description || undefined,
    metadata: { sku }
  });
};

// Create or find a Price (USD one-time) for the product
const findOrCreatePrice = async ({ productId, unitAmount }) => {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const existing = prices.data.find(p =>
    p.currency === 'usd' &&
    p.unit_amount === unitAmount &&
    p.recurring == null
  );
  if (existing) return existing;

  return stripe.prices.create({
    currency: 'usd',
    unit_amount: unitAmount,
    product: productId
  });
};

// Create or find a Payment Link
const findOrCreatePaymentLink = async ({ priceId }) => {
  // Stripe Payment Links API doesn’t “search”; we recreate when missing.
  return stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: { type: 'redirect', redirect: { url: 'https://thankyou.example.com' } }
  });
};

// --- Main ---
const items = await readNotion();
let created = 0, updated = 0, skipped = 0, errors = 0;

for (const item of items) {
  // Adapt to your products.json shape
  const pageId = item.page_id || item.id;
  const name   = item['Product Name'] || item.name;
  const sku    = item['Product SKU']  || item.sku;
  const cents  = Math.round((item.price || item['Price'] || 0) * 100);

  if (!pageId || !name || !sku || !cents) { skipped++; continue; }

  try {
    // Live vs Test switch: we always create links against the provided key.
    const product = await findOrCreateProduct({ name, sku, description: item.description });
    const price   = await findOrCreatePrice({ productId: product.id, unitAmount: cents });
    const link    = await findOrCreatePaymentLink({ priceId: price.id });

    // Decide which Notion field to update
    const liveUrl = (STRIPE_MODE === 'live') ? link.url : undefined;
    const testUrl = (STRIPE_MODE === 'test') ? link.url : undefined;

    await updateNotionRow({ pageId, liveUrl, testUrl });
    updated++;
    await delay(200); // be nice to rate limits
  } catch (e) {
    errors++;
    console.error(`Upsert failed for ${name} (${sku}):`, e.message);
  }
}

console.log(JSON.stringify({ mode: STRIPE_MODE, updated, created, skipped, errors }, null, 2));