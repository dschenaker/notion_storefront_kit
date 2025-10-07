// Notion → data/products.json  (robust + image/category fixes)
// Usage: node scripts/notion_sync.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---- ENV ----
const NOTION_TOKEN = (process.env.NOTION_TOKEN || '').trim();
const RAW_DB_ID    = (process.env.NOTION_DB_ID || '').trim();
const RAW_DB_URL   = (process.env.NOTION_DB_URL || '').trim();
const DB_NAME_HINT = (process.env.NOTION_DB_NAME || '').trim();

if (!NOTION_TOKEN) {
  console.error('❌ Missing NOTION_TOKEN in .env or GitHub Secrets');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ---- Property map (edit the right-hand side to match your Notion column labels) ----
const PROPERTY_MAP = {
  Name: 'Product Name',
  SKU: 'Product SKU',
  Price: 'Price',
  Image: 'Image',
  Logo: 'Logo',
  Category: 'Category',       // supports select or multi-select
  Description: 'Description',
  Active: 'Active',
  PaymentURL: 'PaymentURL'
};

// ---- Helpers ----
function extractIdFromUrl(url) {
  const m = (url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}

async function resolveDatabaseId() {
  // 1) explicit ID
  if (RAW_DB_ID) return RAW_DB_ID.replace(/-/g, '').toLowerCase();

  // 2) from URL
  const fromUrl = extractIdFromUrl(RAW_DB_URL);
  if (fromUrl) return fromUrl.toLowerCase();

  // 3) search by name
  if (DB_NAME_HINT) {
    const search = await notion.search({
      query: DB_NAME_HINT,
      filter: { property: 'object', value: 'database' }
    });
    const hit = (search.results || []).map(r => ({
      id: (r.id || '').replace(/-/g, ''),
      title: (r.title?.[0]?.plain_text || '').trim()
    }))
    .sort((a,b) => (b.title === DB_NAME_HINT) - (a.title === DB_NAME_HINT))[0];
    if (hit) return hit.id;
  }

  throw new Error('Could not resolve a database. Provide NOTION_DB_ID or NOTION_DB_URL or NOTION_DB_NAME.');
}

// text
function richTextToPlain(rt) {
  return (rt || []).map(x => x?.plain_text || '').join('').trim();
}

// first URL from "files" (external or uploaded)
function firstFileUrl(files) {
  const f = (files || [])[0];
  if (!f) return '';
  // prefer explicit external url, else signed file url
  return (f.external && f.external.url) || (f.file && f.file.url) || '';
}

// raw Notion value → JS
function val(props, key) {
  const p = props[key];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return richTextToPlain(p.title);
    case 'rich_text':    return richTextToPlain(p.rich_text);
    case 'number':       return p.number;
    case 'checkbox':     return p.checkbox;
    case 'url':          return p.url;
    case 'select':       return p.select ? p.select.name : null;
    case 'multi_select': return (p.multi_select || []).map(x => x.name).filter(Boolean);
    case 'files':        return firstFileUrl(p.files);
    default:             return null;
  }
}

// get by logical property name via PROPERTY_MAP, with graceful fallback
function V(props, logical) {
  const label = PROPERTY_MAP[logical] || logical;
  return val(props, label) ?? val(props, logical) ?? null;
}

// normalize a Notion page to our product shape
function mapPage(p) {
  const props = p.properties || {};
  const name = V(props, 'Name');

  // Category may be array (multi-select) or string
  let category = V(props, 'Category') || '';
  if (Array.isArray(category)) category = category.join(', ');

  return {
    id: p.id,
    name,
    sku:         V(props, 'SKU') || '',
    price:       Number(V(props, 'Price') || 0),
    image:       V(props, 'Image') || '',
    logo:        V(props, 'Logo') || '',
    category,    // normalized string
    description: V(props, 'Description') || '',
    active:      V(props, 'Active') !== false, // treat missing as active
    payment_url: V(props, 'PaymentURL') || ''
  };
}

async function fetchAllPages(database_id) {
  const out = [];
  let cursor;

  do {
    const res = await notion.databases.query({
      database_id,
      start_cursor: cursor,
      page_size: 100
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return out;
}

function ensureDir(p) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
}

// ---- main ----
(async () => {
  try {
    const dbid = await resolveDatabaseId();
    const dbidPretty = dbid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    console.log('[DEBUG] Using database ID:', dbid);
    let meta;
    try {
      meta = await notion.databases.retrieve({ database_id: dbidPretty });
      const title = meta?.title?.[0]?.plain_text || '(untitled)';
      console.log('[DEBUG] DB title:', title);
      console.log('[DEBUG] Properties:', Object.keys(meta.properties || {}).join(', '));
    } catch (e) {
      console.warn('[WARN] failed to retrieve DB meta (still continuing):', e.body?.message || e.message);
    }

    const pages = await fetchAllPages(dbidPretty);
    const products = pages
      .map(mapPage)
      .filter(p => p.name && p.active);

    // sort by name for stable output
    products.sort((a,b) => a.name.localeCompare(b.name));

    const outPath = path.join(__dirname, '..', 'data', 'products.json');
    ensureDir(outPath);
    fs.writeFileSync(outPath, JSON.stringify(products, null, 2));
    console.log(`✅ Wrote ${products.length} products → ${outPath}`);

    // tiny sample line (helps when debugging in Actions logs)
    if (products[0]) {
      console.log('e.g.', {
        name: products[0].name,
        category: products[0].category,
        price: products[0].price,
        image: !!products[0].image,
        logo: !!products[0].logo
      });
    }
  } catch (err) {
    console.error('❌ Sync failed:', err.body?.message || err.message || err);
    process.exit(1);
  }
})();