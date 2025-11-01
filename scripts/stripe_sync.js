// scripts/stripe_sync.js
// Upserts Stripe Product/Price/PaymentLink for products missing links
// Env: STRIPE_API_KEY, NOTION_TOKEN, NOTION_DB_ID, [STRIPE_MODE=test|live]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Stripe from 'stripe';
import { Client as Notion } from '@notionhq/client';

const {
  STRIPE_API_KEY,
  NOTION_TOKEN,
  NOTION_DB_ID,
  STRIPE_MODE = 'test',
} = process.env;

if (!STRIPE_API_KEY) throw new Error('Missing STRIPE_API_KEY');
if (!NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
if (!NOTION_DB_ID) throw new Error('Missing NOTION_DB_ID');

const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2023-10-16' });
const notion = new Notion({ auth: NOTION_TOKEN });

const DATA_FILE = path.join(process.cwd(), 'data', 'products.json');

// --- Helpers ---------------------------------------------------------------

const asCents = (val) => {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
};

function getProp(page, name) {
  return page.properties?.[name];
}

function asTitleText(prop) {
  return (prop?.title || []).map(t => t.plain_text).join('');
}

function asRichText(prop) {
  return (prop?.rich_text || []).map(t => t.plain_text).join('');
}

function asNumber(prop) {
  return prop?.number ?? null;
}

function asSelect(prop) {
  return prop?.select?.name ?? null;
}

function asMultiSelect(prop) {
  return (prop?.multi_select || []).map(x => x.name);
}

function asURL(prop) {
  return prop?.url ?? null;
}

async function updateNotion(pageId, fields) {
  return notion.pages.update({
    page_id: pageId,
    properties: fields,
  });
}

async function findStripeProductBySKU(sku) {
  const list = await stripe.products.list({ limit: 1, active: true, expand: [], shippable: null, url: null, ids: undefined, type: undefined, created: undefined, starting_after: undefined, ending_before: undefined, expand: [] , metadata: undefined, });
  // The list API doesn't filter by metadata; do a broader search:
  // Use search API (supports metadata).
  const res = await stripe.products.search({
    query: `active:'true' AND metadata['sku']:'${sku.replace(/'/g, "\\'")}'`,
    limit: 1,
  });
  return res.data[0] || null;
}

async function ensureStripeProduct({ name, description, sku, imageUrl }) {
  // Try by SKU in metadata
  let product = sku ? await findStripeProductBySKU(sku) : null;

  if (!product) {
    product = await stripe.products.create({
      name,
      description: description || undefined,
      active: true,
      images: imageUrl ? [imageUrl] : undefined,
      metadata: sku ? { sku } : undefined,
    });
    console.log(`  + Created product ${product.id} for SKU ${sku || '(none)'}`);
  } else {
    // Light update if fields changed (don’t thrash)
    await stripe.products.update(product.id, {
      name,
      description: description || undefined,
      images: imageUrl ? [imageUrl] : undefined,
      metadata: sku ? { sku } : undefined,
      active: true,
    });
    console.log(`  = Reused product ${product.id} for SKU ${sku || '(none)'}`);
  }

  return product;
}

async function ensureStripePrice({ productId, unitAmount, currency = 'USD' }) {
  if (!unitAmount || unitAmount <= 0) throw new Error('Missing/invalid price');

  // Strategy: create a new Price when amount changes; keep old ones archived.
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 10 });
  const match = prices.data.find(p => p.unit_amount === unitAmount && p.currency.toLowerCase() === currency.toLowerCase());

  if (match) {
    console.log(`  = Reused price ${match.id} ${unitAmount} ${currency}`);
    return match;
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: currency.toLowerCase(),
  });
  console.log(`  + Created price ${price.id} ${unitAmount} ${currency}`);
  return price;
}

async function ensurePaymentLink({ priceId }) {
  // Search by price in metadata is not supported on PaymentLinks;
  // Instead, create a new link each time if needed. Idempotency is handled per run.
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
    // Add defaults here if you want to collect address/phone, etc.
    // allowing_promotion_codes: true,
  });
  console.log(`  + Created payment link ${link.url}`);
  return link;
}

// --- Main ------------------------------------------------------------------

(async () => {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const list = JSON.parse(raw);

  let considered = 0;
  let created = 0;
  let skipped = 0;

  for (const item of list) {
    // Expecting the Notion page echo. Be tolerant in field names.
    const pageId = item.id || item.pageId;
    const name = item.name || item['Product Name'] || item.productName || '';
    const sku  = (item.sku || item['Product SKU'] || item.productSKU || '').trim();
    const currency = (item.currency || item['Currency'] || 'USD').toUpperCase();
    const imageUrl = item.image || item.imageUrl || null;
    const linkUrl = item.paymentLink || item['Stripe Link'] || item.stripeLink || null;

    // Price can be number or string. Prefer explicit numeric `price`, fall back to ‘Price’.
    let priceNum = item.price ?? item['Price'] ?? null;
    const unitAmount = asCents(priceNum);

    considered++;

    // Skip if already has a link (we don’t touch legacy rows)
    if (linkUrl) {
      skipped++;
      continue;
    }
    // Require minimum fields for creation
    if (!name || !unitAmount || unitAmount <= 0) {
      console.log(`~ Skip (incomplete): name="${name}" unitAmount=${unitAmount} sku="${sku}" page=${pageId}`);
      skipped++;
      continue;
    }

    console.log(`\nProcessing: ${name} (SKU: ${sku || '—'}) price=${unitAmount} ${currency}`);

    // 1) Product
    const product = await ensureStripeProduct({
      name,
      description: sku ? `SKU ${sku}` : undefined,
      sku,
      imageUrl,
    });

    // 2) Price
    const price = await ensureStripePrice({
      productId: product.id,
      unitAmount,
      currency,
    });

    // 3) Payment Link
    const link = await ensurePaymentLink({ priceId: price.id });

    // 4) Write back to Notion (Stripe Link, Stripe Product ID, Stripe Price ID)
    if (pageId) {
      await updateNotion(pageId, {
        'Stripe Link': { url: link.url },
        'Stripe Product ID': { rich_text: [{ type: 'text', text: { content: product.id } }] },
        'Stripe Price ID':   { rich_text: [{ type: 'text', text: { content: price.id } }] },
      });
      console.log(`  ↳ Notion updated for ${pageId}`);
    }

    created++;
  }

  console.log(`\nStripe sync summary: considered=${considered} created=${created} skipped=${skipped}`);
})().catch(err => {
  console.error('Stripe sync failed:', err?.message || err);
  process.exit(1);
});