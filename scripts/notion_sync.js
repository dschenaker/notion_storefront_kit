// scripts/notion_sync.js
// Notion → data/products.json (robust + multi-image + mirroring + safe fallbacks)
//
// Usage: node scripts/notion_sync.js
//
// Env (local .env or GitHub Secrets):
//   NOTION_TOKEN=ntn_xxx
//   # choose one:
//   NOTION_DB_ID=284a1cfa47e880b289fff500602fe085
//   NOTION_DB_URL=https://www.notion.so/.../284a1cfa47e880b289fff500602fe085?v=...
//   NOTION_DB_NAME=Product Catalog Master
//
// Output:
//   data/products.json
//   assets/media/* (downloaded images/logos, permanent links for Pages)

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
// Adjust right-hand labels only if your column names differ.
const PROPERTY_MAP = {
  Name:        'Product Name',
  SKU:         'Product SKU',
  Price:       'Price',
  Image:       'Image',        // files / url / rich_text / formula / rollup
  Logo:        'Logo',         // files / url / rich_text / formula / rollup
  Category:    'Category',     // select or multi-select
  Description: 'Description',
  Active:      'Active',
  PaymentURL:  'PaymentURL'
};

// ====== OUTPUT PATHS ======
const OUT_JSON   = path.join(__dirname, '..', 'data', 'products.json');
const MEDIA_DIR  = path.join(__dirname, '..', 'assets', 'media');  // directory to write images
const MEDIA_HREF = 'assets/media';                                  // href used in JSON

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
// returns true if label looks like an image-y field
function isImageyLabel(label) {
  return /^(image|images|gallery|photos?|pictures?|pics?)$/i.test(label);
}

// try to extract *multiple* image URLs from any property payload
function imageUrlsFromProp(prop) {
  // reuse your existing urlsFromAny() that returns an array of URLs
  const urls = urlsFromAny(prop) || [];
  // keep only things that look like images (basic filter)
  return urls.filter(u => /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/i.test(u) || /image\//i.test(u));
}

// fetch page cover (Notion’s page “cover” field)
async function getPageCoverUrl(notion, pageId) {
  try {
    const dash = pageId; // page ids from query are already dashed
    const page = await notion.pages.retrieve({ page_id: dash });
    const cover = page.cover;
    if (!cover) return '';
    if (cover.external?.url) return cover.external.url;
    if (cover.file?.url)     return cover.file.url;
    return '';
  } catch {
    return '';
  }
}
const rt2text = (rt) => (rt || []).map(x => x?.plain_text || '').join('').trim();

// Extract **array** of URLs from many Notion shapes
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

// Exact label → logical → heuristics (regex/type)
function V(props, logical, heuristics = []) {
  const exact = props[PROPERTY_MAP[logical]];
  const logicalProp = props[logical];

  let v = rawVal(exact ?? logicalProp);
  if (v) return v;

  for (const h of heuristics) {
    const ent = Object.entries(props).find(([label, p]) =>
      h.includes.test(label) && (!h.type || p.type === h.type)
    );
    if (ent) { v = rawVal(ent[1]); if (v) return v; }
  }
  return null;
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

// Download bytes to assets/media; return local href or ''
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

    const imgHeur  = [{ includes: /^image(s)?$/i }, { includes: /photo|picture|img/i }];
    const logoHeur = [{ includes: /^logo(s)?$/i },  { includes: /brand|logo/i }];

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

            // 1) Start with the primary Image column (may already be an array)
      let rawImages = V(props, 'Image', [{ includes:/^image(s)?$/i }, { includes:/photo|picture|img/i }]) || [];
      if (!Array.isArray(rawImages)) rawImages = rawImages ? [rawImages] : [];

      // 2) Scan ALL properties for additional image-like fields (files/url/etc)
      for (const [label, prop] of Object.entries(props)) {
        // skip if it's literally our mapped Image or Logo field
        const mappedImage = PROPERTY_MAP.Image || 'Image';
        const mappedLogo  = PROPERTY_MAP.Logo  || 'Logo';
        if (label === mappedImage || label === mappedLogo) continue;

        if (prop?.type === 'files' && isImageyLabel(label)) {
          rawImages.push(...imageUrlsFromProp(prop));
        } else if (isImageyLabel(label)) {
          rawImages.push(...imageUrlsFromProp(prop));
        }
      }

      // 3) Also try the page cover
      const coverUrl = await getPageCoverUrl(notion, pg.id);
      if (coverUrl) rawImages.push(coverUrl);

      // Deduplicate, cap to something reasonable
      rawImages = Array.from(new Set(rawImages)).slice(0, 12);

      // Mirror all images (first becomes primary)
      const images = [];
      for (let i = 0; i < rawImages.length; i++) {
        const url  = rawImages[i];
        const href = url ? await mirrorOne(url, `${id.replace(/-/g, '')}-image-${i}`) : '';
        if (href) { images.push(href); mirrored++; }
      }

      // Mirror first logo only
      let logo = '';
      if (rawLogos[0]) {
        const lh = await mirrorOne(rawLogos[0], `${id.replace(/-/g, '')}-logo`);
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
        image: images[0] || prev.image || '',  // keep legacy primary
        images,                                 // full gallery
        logo,
        category,
        description,
        active,
        payment_url
      });
    }

    // stable sort
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