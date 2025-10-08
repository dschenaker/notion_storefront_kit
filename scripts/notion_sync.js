// scripts/notion_sync.js
// Notion → data/products.json with deterministic multi-image intake
// Columns used (case-sensitive):
//   Product Name (title), Product SKU (text), Price (number)
//   Image (files or url), Logo (files or url)
//   Variant 1..Variant 5 (each: files or url)  ← add more in VARIANT_COLUMNS if needed
//   Category (select or multi-select), Description (rich_text), Active (checkbox),
//   PaymentURL (url)  ← optional; preserved if present
//
// Output:
//   data/products.json
//   assets/media/* (mirrored images for permanent URLs)
// Usage: node scripts/notion_sync.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ====== ENV ======
const NOTION_TOKEN = (process.env.NOTION_TOKEN || '').trim();
const RAW_DB_ID    = (process.env.NOTION_DB_ID || '').trim();
const RAW_DB_URL   = (process.env.NOTION_DB_URL || '').trim();
const DB_NAME_HINT = (process.env.NOTION_DB_NAME || '').trim();

if (!NOTION_TOKEN) {
  console.error('❌ Missing NOTION_TOKEN');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ====== CONFIG: map logical → your Notion column labels ======
const PROPERTY_MAP = {
  Name:        'Product Name',
  SKU:         'Product SKU',
  Price:       'Price',
  Image:       'Image',
  Logo:        'Logo',
  Category:    'Category',
  Description: 'Description',
  Active:      'Active',
  PaymentURL:  'PaymentURL'
};

// Deterministic extra image columns. Add/remove as you like.
const VARIANT_COLUMNS = [
  'Variant 1',
  'Variant 2',
  'Variant 3',
  'Variant 4',
  'Variant 5'
];

// ====== OUTPUT PATHS ======
const OUT_JSON   = path.join(__dirname, '..', 'data', 'products.json');
const MEDIA_DIR  = path.join(__dirname, '..', 'assets', 'media');
const MEDIA_HREF = 'assets/media';

// ====== FS helpers ======
function ensureFileParent(fp) { fs.mkdirSync(path.dirname(fp), { recursive: true }); }
function ensureDir(dir)      { fs.mkdirSync(dir, { recursive: true }); }

// Load previous JSON to avoid blanking images/logos if mirroring fails
function loadPrevProducts() {
  try {
    const raw = fs.readFileSync(OUT_JSON, 'utf8');
    const arr = JSON.parse(raw);
    const map = new Map();
    arr.forEach(p => map.set(p.id, p));
    return map;
  } catch {
    return new Map();
  }
}

// ====== Notion helpers ======
function extractIdFromUrl(url) {
  const m = (url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}

async function resolveDatabaseId() {
  if (RAW_DB_ID) return RAW_DB_ID.replace(/-/g, '').toLowerCase();

  const fromUrl = extractIdFromUrl(RAW_DB_URL);
  if (fromUrl) return fromUrl.toLowerCase();

  if (DB_NAME_HINT) {
    const res = await notion.search({
      query: DB_NAME_HINT,
      filter: { property: 'object', value: 'database' }
    });
    const hit = (res.results || [])
      .map(r => ({ id: (r.id || '').replace(/-/g, ''), title: r.title?.[0]?.plain_text?.trim() || '' }))
      .sort((a, b) => (b.title === DB_NAME_HINT) - (a.title === DB_NAME_HINT))[0];
    if (hit) return hit.id;
  }

  throw new Error('Could not resolve a database. Provide NOTION_DB_ID or NOTION_DB_URL or NOTION_DB_NAME.');
}

const rt2text = (rt) => (rt || []).map(x => x?.plain_text || '').join('').trim();

// Return **array** of URLs from common Notion shapes
function urlsFromAny(v) {
  const out = [];
  const push = (u) => { if (u && typeof u === 'string') out.push(u); };

  if (!v) return out;
  if (typeof v === 'string') { push(v); return out; }

  if (Array.isArray(v)) {
    for (const it of v) urlsFromAny(it).forEach(push);
    return out;
  }

  if (v.file?.url) push(v.file.url);
  if (v.external?.url) push(v.external.url);

  if (v.rich_text) urlsFromAny(rt2text(v.rich_text)).forEach(push);
  if (v.formula?.string) push(v.formula.string);

  if (v.rollup?.array) urlsFromAny(v.rollup.array).forEach(push);

  if (v.url) push(v.url);
  if (v.title) urlsFromAny(rt2text(v.title)).forEach(push);

  return out;
}

function rawVal(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':        return rt2text(prop.title);
    case 'rich_text':    return rt2text(prop.rich_text);
    case 'number':       return prop.number;
    case 'checkbox':     return prop.checkbox;
    case 'url':          return prop.url;
    case 'select':       return prop.select ? prop.select.name : null;
    case 'multi_select': return (prop.multi_select || []).map(x => x.name).filter(Boolean);
    case 'files':        return urlsFromAny(prop.files); // array
    case 'formula':      return urlsFromAny(prop);
    case 'rollup':       return urlsFromAny(prop);
    default:             return null;
  }
}

function V(props, logical) {
  const exact = props[PROPERTY_MAP[logical]];
  const logicalProp = props[logical];
  return rawVal(exact ?? logicalProp);
}

const normalizeCategory = (val) => Array.isArray(val) ? val.join(', ') : (val || '');

async function fetchAllPages(database_id) {
  const out = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id, start_cursor: cursor, page_size: 100 });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ====== Media download/mirroring ======
function extFromContentType(ct) {
  if (!ct) return 'bin';
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('png'))  return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif'))  return 'gif';
  if (ct.includes('svg'))  return 'svg';
  return ct.split('/').pop().split(';')[0] || 'bin';
}

async function mirrorOne(url, baseName) {
  try {
    ensureDir(MEDIA_DIR);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct   = res.headers.get('content-type') || '';
    const ext  = extFromContentType(ct);
    const file = `${baseName}.${ext}`;
    const disk = path.join(MEDIA_DIR, file);
    const buf  = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(disk, buf);
    return `${MEDIA_HREF}/${file}`;
  } catch (e) {
    console.warn('  [media] failed:', e.message);
    return '';
  }
}

// ====== MAIN ======
(async () => {
  try {
    const prevById = loadPrevProducts();

    const dbid   = await resolveDatabaseId();
    const dashId = dbid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    console.log('[DEBUG] Using DB:', dbid);

    try {
      const meta = await notion.databases.retrieve({ database_id: dashId });
      const title = meta?.title?.[0]?.plain_text || '(untitled)';
      const keys = Object.entries(meta.properties || {}).map(([k, p]) => `${k} <${p.type}>`);
      console.log('[DEBUG] DB title:', title);
      console.log('[DEBUG] Properties:', keys.join(', '));
    } catch (e) {
      console.warn('[WARN] retrieve meta failed:', e.body?.message || e.message);
    }

    const pages = await fetchAllPages(dashId);
    console.log(`[DEBUG] Pages: ${pages.length}`);

    let mirrored = 0, reused = 0;
    const products = [];

    for (const pg of pages) {
      const props  = pg.properties || {};
      const id     = pg.id;
      const prev   = prevById.get(id) || {};

      const name   = V(props, 'Name') || '(unnamed)';
      const active = V(props, 'Active') !== false;
      if (!name || !active) continue;

      const sku         = V(props, 'SKU') || '';
      const price       = Number(V(props, 'Price') || 0);
      const category    = normalizeCategory(V(props, 'Category'));
      const description = V(props, 'Description') || '';
      const payment_url = V(props, 'PaymentURL') || prev.payment_url || '';

      // --- Collect primary + auto-detected variant columns ---

      // Start with the primary mapped Image field
      let rawImages = [];
      const primary = V(props, 'Image');
      if (primary) rawImages.push(...(Array.isArray(primary) ? primary : [primary]));

      // Auto-detect any column that looks like a variant/gallery/image #
      // Examples matched: "Variant 1", "Variant1", "Variant 01", "Image 2", "Images 3", "Gallery 4"
      const VARIANT_RE = /^(variant|image|images|gallery)\s*0*\d+$/i;

      const variantCols = Object.keys(props).filter(k => VARIANT_RE.test(k));
      if (variantCols.length) {
        for (const col of variantCols) {
          const v = rawVal(props[col]);
          if (!v) continue;
          const arr = Array.isArray(v) ? v : [v];
          rawImages.push(...arr);
        }
      }

      // Deduplicate + cap
      rawImages = Array.from(new Set(rawImages)).slice(0, 20);
      // --- Logo (first only) ---
      let rawLogo = '';
      const logoVal = V(props, 'Logo');
      if (logoVal) {
        const arr = Array.isArray(logoVal) ? logoVal : [logoVal];
        rawLogo = arr[0] || '';
      }

      // Mirror images
      const images = [];
      for (let i = 0; i < rawImages.length; i++) {
        const url  = rawImages[i];
        const href = url ? await mirrorOne(url, `${id.replace(/-/g, '')}-image-${i}`) : '';
        if (href) { images.push(href); mirrored++; }
      }

      // Mirror logo
      let logo = '';
      if (rawLogo) {
        const lh = await mirrorOne(rawLogo, `${id.replace(/-/g, '')}-logo`);
        if (lh) { logo = lh; mirrored++; }
      }

      // Fallback to previous JSON if mirroring failed
      if (!images.length && Array.isArray(prev.images) && prev.images.length) { images.push(...prev.images); reused++; }
      if (!logo && prev.logo) { logo = prev.logo; reused++; }

      products.push({
        id,
        name,
        sku,
        price,
        image: images[0] || prev.image || '',
        images,
        logo,
        category,
        description,
        active,
        payment_url
      });

      // per-product debug
      console.log(`  • ${name}: images=${images.length}${logo ? ', logo=1' : ''}  [from: Image + ${variantCols.join(', ') || '—'}]`);
    }

    products.sort((a, b) => a.name.localeCompare(b.name));

    ensureFileParent(OUT_JSON);
    fs.writeFileSync(OUT_JSON, JSON.stringify(products, null, 2));
    console.log(`✅ Wrote ${products.length} products → ${OUT_JSON}`);
    console.log(`✅ Mirrored media files: ${mirrored} → ${MEDIA_DIR}`);
    if (reused) console.log(`ℹ️ Reused ${reused} image/logo sets from previous JSON to avoid blanking`);
  } catch (err) {
    console.error('❌ Sync failed:', err.body?.message || err.message || err);
    process.exit(1);
  }
})();