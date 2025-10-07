// Notion → data/products.json (auto-detect Image/Logo + multi-select Category)
// Usage: node scripts/notion_sync.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ------- ENV -------
const NOTION_TOKEN = (process.env.NOTION_TOKEN || '').trim();
const RAW_DB_ID    = (process.env.NOTION_DB_ID || '').trim();
const RAW_DB_URL   = (process.env.NOTION_DB_URL || '').trim();
const DB_NAME_HINT = (process.env.NOTION_DB_NAME || '').trim();

if (!NOTION_TOKEN) {
  console.error('❌ Missing NOTION_TOKEN');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ------- Property Map (left = logical name; right = your Notion label) -------
// If labels don’t match, we’ll also try heuristics (see below).
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

// ------- Helpers -------
function extractIdFromUrl(url){ const m=(url||'').match(/[0-9a-f]{32}/i); return m?m[0]:''; }

async function resolveDatabaseId(){
  if (RAW_DB_ID) return RAW_DB_ID.replace(/-/g,'').toLowerCase();
  const fromUrl = extractIdFromUrl(RAW_DB_URL);
  if (fromUrl) return fromUrl.toLowerCase();
  if (DB_NAME_HINT){
    const search = await notion.search({
      query: DB_NAME_HINT,
      filter: { property: 'object', value: 'database' }
    });
    const hit = (search.results||[])
      .map(r=>({ id:(r.id||'').replace(/-/g,''), title:r.title?.[0]?.plain_text?.trim()||'' }))
      .sort((a,b)=>(b.title===DB_NAME_HINT)-(a.title===DB_NAME_HINT))[0];
    if (hit) return hit.id;
  }
  throw new Error('Could not resolve a database ID. Provide NOTION_DB_ID or NOTION_DB_URL or NOTION_DB_NAME.');
}

function richTextToPlain(rt){ return (rt||[]).map(x=>x?.plain_text||'').join('').trim(); }

function firstFileUrl(files){
  const f=(files||[])[0]; if(!f) return '';
  return (f.external && f.external.url) || (f.file && f.file.url) || '';
}

function rawVal(prop){
  if(!prop) return null;
  switch(prop.type){
    case 'title': return richTextToPlain(prop.title);
    case 'rich_text': return richTextToPlain(prop.rich_text);
    case 'number': return prop.number;
    case 'checkbox': return prop.checkbox;
    case 'url': return prop.url;
    case 'select': return prop.select ? prop.select.name : null;
    case 'multi_select': return (prop.multi_select||[]).map(x=>x.name).filter(Boolean);
    case 'files': return firstFileUrl(prop.files);
    default: return null;
  }
}

// try exact label → logical → heuristics
function V(props, logical, heuristics=[]){
  const exact = props[PROPERTY_MAP[logical]];
  const logicalLabel = props[logical];
  let v = rawVal(exact ?? logicalLabel);
  if (v) return v;

  // heuristic: find first property by regex candidates and type preference
  if (heuristics.length){
    for (const h of heuristics){
      // h = { includes: /image|photo|pic/i, type: 'files' }
      const entries = Object.entries(props);
      // prefer exact type match if specified
      const match = entries.find(([label, prop]) =>
        h.includes.test(label) && (!h.type || prop.type === h.type)
      );
      if (match){ v = rawVal(match[1]); if (v) return v; }
    }
  }
  return null;
}

function normalizeCategory(val){
  if (Array.isArray(val)) return val.join(', ');
  return val || '';
}

async function fetchAllPages(database_id){
  const out=[]; let cursor;
  do{
    const res = await notion.databases.query({ database_id, start_cursor:cursor, page_size:100 });
    out.push(...res.results); cursor = res.has_more ? res.next_cursor : undefined;
  }while(cursor);
  return out;
}

function ensureDir(fp){ fs.mkdirSync(path.dirname(fp), { recursive:true }); }

// ------- main -------
(async()=>{
  try{
    const dbid = await resolveDatabaseId();
    const dashId = dbid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
    console.log('[DEBUG] Using DB:', dbid);

    // Read DB meta so we can print types and aid heuristics
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
    const products = pages.map(p=>{
      const props = p.properties || {};

      // Heuristic candidates
      const imgHeur = [
        { includes:/^image(s)?$/i, type:'files' },
        { includes:/photo|picture|img/i, type:'files' },
        { includes:/image|photo|picture|img/i } // any type
      ];
      const logoHeur = [
        { includes:/^logo(s)?$/i, type:'files' },
        { includes:/brand|logo/i, type:'files' },
        { includes:/logo|brand/i }
      ];

      const name = V(props, 'Name') || '(unnamed)';

      let image = V(props, 'Image', imgHeur) || '';
      let logo  = V(props, 'Logo',  logoHeur) || '';

      const category = normalizeCategory( V(props, 'Category') );

      return {
        id: p.id,
        name,
        sku:         V(props,'SKU') || '',
        price:       Number(V(props,'Price')||0),
        image,
        logo,
        category,
        description: V(props,'Description') || '',
        active:      V(props,'Active') !== false,
        payment_url: V(props,'PaymentURL') || ''
      };
    }).filter(p=>p.name && p.active);

    // Helpful summary
    const imgCount  = products.filter(p=>!!p.image).length;
    const logoCount = products.filter(p=>!!p.logo).length;
    console.log(`[DEBUG] Products ready: ${products.length} (images: ${imgCount}, logos: ${logoCount})`);
    if (products[0]){
      console.log('[DEBUG] Sample:', {
        name: products[0].name,
        category: products[0].category,
        image: products[0].image ? 'yes' : 'no',
        logo: products[0].logo ? 'yes' : 'no'
      });
    }

    // Write JSON
    const outPath = path.join(__dirname,'..','data','products.json');
    ensureDir(outPath);
    fs.writeFileSync(outPath, JSON.stringify(products, null, 2));
    console.log(`✅ Wrote ${products.length} products → ${outPath}`);
  }catch(err){
    console.error('❌ Sync failed:', err.body?.message || err.message || err);
    process.exit(1);
  }
})();