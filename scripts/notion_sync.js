// Notion → data/products.json (robust fields + media mirroring to assets/media)
// Usage: node scripts/notion_sync.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const NOTION_TOKEN = (process.env.NOTION_TOKEN || '').trim();
const RAW_DB_ID    = (process.env.NOTION_DB_ID || '').trim();
const RAW_DB_URL   = (process.env.NOTION_DB_URL || '').trim();
const DB_NAME_HINT = (process.env.NOTION_DB_NAME || '').trim();

if (!NOTION_TOKEN) { console.error('❌ Missing NOTION_TOKEN'); process.exit(1); }

const notion = new Client({ auth: NOTION_TOKEN });

// ===== config =====
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

const OUT_JSON   = path.join(__dirname, '..', 'data', 'products.json');
const MEDIA_DIR  = path.join(__dirname, '..', 'assets', 'media');      // written during CI
const MEDIA_HREF = 'assets/media';                                     // href used in pages

// ===== helpers =====
function ensureDir(fp){ fs.mkdirSync(path.dirname(fp), { recursive:true }); }
function extractIdFromUrl(url){ const m=(url||'').match(/[0-9a-f]{32}/i); return m?m[0]:''; }
async function resolveDatabaseId(){
  if (RAW_DB_ID) return RAW_DB_ID.replace(/-/g,'').toLowerCase();
  const fromUrl = extractIdFromUrl(RAW_DB_URL); if (fromUrl) return fromUrl.toLowerCase();
  if (DB_NAME_HINT){
    const s = await notion.search({ query: DB_NAME_HINT, filter:{ property:'object', value:'database' } });
    const hit = (s.results||[])
      .map(r=>({ id:(r.id||'').replace(/-/g,''), title:r.title?.[0]?.plain_text?.trim()||'' }))
      .sort((a,b)=>(b.title===DB_NAME_HINT)-(a.title===DB_NAME_HINT))[0];
    if (hit) return hit.id;
  }
  throw new Error('Could not resolve a database ID. Provide NOTION_DB_ID or NOTION_DB_URL or NOTION_DB_NAME.');
}

// ---------- media helpers (arrays) ----------
const rt2text = (rt)=> (rt||[]).map(x=>x?.plain_text||'').join('').trim();

function urlsFromAny(v){
  // return an array of URLs from many Notion shapes
  const out = [];
  if (!v) return out;

  const push = (u)=>{ if (u && typeof u === 'string') out.push(u); };

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

function rawVal(prop){
  if(!prop) return null;
  switch(prop.type){
    case 'title':        return rt2text(prop.title);
    case 'rich_text':    return rt2text(prop.rich_text);
    case 'number':       return prop.number;
    case 'checkbox':     return prop.checkbox;
    case 'url':          return prop.url;
    case 'select':       return prop.select ? prop.select.name : null;
    case 'multi_select': return (prop.multi_select||[]).map(x=>x.name).filter(Boolean);
    case 'files':        return urlsFromAny(prop.files);   // NOTE: now returns array
    case 'formula':      return urlsFromAny(prop);
    case 'rollup':       return urlsFromAny(prop);
    default:             return null;
  }
}

function V(props, logical, heuristics=[]){
  const exact = props[PROPERTY_MAP[logical]];
  const logicalProp = props[logical];

  let v = rawVal(exact ?? logicalProp);
  if (v) return v;

  for (const h of heuristics){
    const ent = Object.entries(props).find(([label,p]) =>
      h.includes.test(label) && (!h.type || p.type === h.type)
    );
    if (ent){ v = rawVal(ent[1]); if (v) return v; }
  }
  return null;
}
const normalizeCategory = (val)=> Array.isArray(val) ? val.join(', ') : (val||'');

// ---- download + rewrite ----
function extFromContentType(ct){
  if (!ct) return 'bin';
  if (ct.includes('jpeg')) return 'jpg';
  if (ct.includes('png'))  return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif'))  return 'gif';
  if (ct.includes('svg'))  return 'svg';
  return ct.split('/').pop().split(';')[0] || 'bin';
}

async function mirrorOne(url, baseName){
  try{
    const res = await fetch(url, { redirect:'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    const ext = extFromContentType(ct);
    const file = `${baseName}.${ext}`;
    const disk = path.join(MEDIA_DIR, file);
    ensureDir(MEDIA_DIR);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(disk, buf);
    return `${MEDIA_HREF}/${file}`;
  }catch(e){
    console.warn('  [media] failed:', e.message);
    return '';
  }
}

// ---- query ----
async function fetchAllPages(database_id){
  const out=[]; let cursor;
  do{
    const res = await notion.databases.query({ database_id, start_cursor:cursor, page_size:100 });
    out.push(...res.results); cursor = res.has_more ? res.next_cursor : undefined;
  }while(cursor);
  return out;
}

// ---- main ----
(async()=>{
  try{
    const dbid   = await resolveDatabaseId();
    const dashId = dbid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
    console.log('[DEBUG] Using DB:', dbid);

    let meta;
    try{
      meta = await notion.databases.retrieve({ database_id: dashId });
      const title = meta?.title?.[0]?.plain_text || '(untitled)';
      console.log('[DEBUG] DB title:', title);
      const keys = Object.entries(meta.properties||{}).map(([k,p])=>`${k} <${p.type}>`);
      console.log('[DEBUG] Properties:', keys.join(', '));
    }catch(e){
      console.warn('[WARN] retrieve meta failed:', e.body?.message || e.message);
    }

    const pages = await fetchAllPages(dashId);
    console.log(`[DEBUG] Pages: ${pages.length}`);

    const imgHeur  = [{ includes:/^image(s)?$/i }, { includes:/photo|picture|img/i }];
    const logoHeur = [{ includes:/^logo(s)?$/i },  { includes:/brand|logo/i }];

    let mirrored = 0;

    const products = [];
    for (const pg of pages){
      const props = pg.properties || {};
      const name = V(props,'Name') || '(unnamed)';
      const active = V(props,'Active') !== false;
      if (!name || !active) continue;

      const sku   = V(props,'SKU') || '';
      const price = Number(V(props,'Price') || 0);
      const category = normalizeCategory( V(props,'Category') );
      const description = V(props,'Description') || '';
      const payment_url = V(props,'PaymentURL') || '';

      // raw arrays from Notion
      const rawImages = (V(props, 'Image', [{ includes:/^image(s)?$/i }, { includes:/photo|picture|img/i }]) || []);
      const rawLogos  = (V(props, 'Logo',  [{ includes:/^logo(s)?$/i },  { includes:/brand|logo/i }]) || []);

      // mirror all images (first one becomes the primary)
      const mirroredImages = [];
      for (let i = 0; i < rawImages.length; i++) {
        const url = rawImages[i];
        const href = url ? await mirrorOne(url, `${pg.id.replace(/-/g,'')}-image-${i}`) : '';
        if (href) mirroredImages.push(href);
      }
      let logoHref = '';
      if (rawLogos[0]) logoHref = await mirrorOne(rawLogos[0], `${pg.id.replace(/-/g,'')}-logo`);

      products.push({
        id: pg.id,
        name, sku, price,
        image: mirroredImages[0] || '',   // primary
        images: mirroredImages,           // gallery
        logo: logoHref || '',
        category, description, active, payment_url
      });
    }

    products.sort((a,b)=> a.name.localeCompare(b.name));

    function ensureDir(fp) {
  fs.mkdirSync(path.dirname(fp), { recursive: true }); // <- must use dirname
  }
    fs.writeFileSync(OUT_JSON, JSON.stringify(products, null, 2));
    console.log(`✅ Wrote ${products.length} products → ${OUT_JSON}`);
    console.log(`✅ Mirrored media files: ${mirrored} → ${MEDIA_DIR}`);
  }catch(err){
    console.error('❌ Sync failed:', err.body?.message || err.message || err);
    process.exit(1);
  }
})();