// Notion → data/products.json  (robust DB resolution + Logo support)
// Accepts NOTION_DB_ID or NOTION_DB_URL or NOTION_DB_NAME in .env
// Local:   NOTION_TOKEN=... NOTION_DB_*...  node scripts/notion_sync.js
// Actions: Secrets: NOTION_TOKEN and one of NOTION_DB_ID/URL/NAME

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override: true });
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- ENV ----------
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const RAW_DB_ID    = (process.env.NOTION_DB_ID   || '').trim();
const RAW_DB_URL   = (process.env.NOTION_DB_URL  || '').trim();
const DB_NAME_HINT = (process.env.NOTION_DB_NAME || '').trim();

if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// OPTIONAL: map your Notion property names → canonical names used by the app
// Canonical keys expected: Name, Price, SKU, Image, Logo, Category, Description, Active, PaymentURL
const PROPERTY_MAP = {
  Name: 'Product Name',     // <-- maps to your DB column
  SKU: 'Product SKU',       // <-- maps to your DB column
  Price: 'Price',
  Image: 'Image',
  Logo: 'Logo',
  Category: 'Category',
  Description: 'Description',
  Active: 'Active',
  PaymentURL: 'PaymentURL'
};

// ---------- HELPERS ----------
function extractIdFromUrl(url) {
  const m = (url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : '';
}

async function resolveDatabaseId() {
  if (RAW_DB_ID) return RAW_DB_ID.replace(/-/g, '').toLowerCase();

  const fromUrl = extractIdFromUrl(RAW_DB_URL);
  if (fromUrl) return fromUrl;

  if (DB_NAME_HINT) {
    const search = await notion.search({
      query: DB_NAME_HINT,
      filter: { property: 'object', value: 'database' }
    });
    const hits = (search.results || [])
      .map(r => ({
        id: (r.id || '').replace(/-/g, '').toLowerCase(),
        title: (r.title?.[0]?.plain_text || '').trim()
      }))
      .sort((a,b) => (b.title === DB_NAME_HINT) - (a.title === DB_NAME_HINT));
    if (hits.length) return hits[0].id;
  }

  throw new Error('Could not resolve a database ID. Provide NOTION_DB_ID or NOTION_DB_URL or NOTION_DB_NAME.');
}

function richTextToPlain(rt) {
  return (rt || []).map(r => r.plain_text || '').join('');
}

function firstFileUrl(files) {
  if (!files || !files.length) return '';
  const f = files[0];
  if (f.type === 'file')     return f.file.url;      // Notion-hosted (expires)
  if (f.type === 'external') return f.external.url; // External (stable)
  return '';
}

function val(props, key) {
  const p = props[key];
  if (!p) return null;
  switch (p.type) {
    case 'title':     return richTextToPlain(p.title);
    case 'rich_text': return richTextToPlain(p.rich_text);
    case 'number':    return p.number;
    case 'checkbox':  return p.checkbox;
    case 'select':    return p.select ? p.select.name : null;
    case 'url':       return p.url;
    case 'files':     return firstFileUrl(p.files);
    default:          return null;
  }
}

function V(props, canonicalKey){
  const actual = PROPERTY_MAP?.[canonicalKey] || canonicalKey;
  return val(props, actual);
}

// ---------- CORE ----------
async function fetchAll(DB_ID){
  const all = [];
  let cursor;
  while (true) {
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100
    });
    all.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return all;
}

function mapPage(p){
  const props = p.properties || {};
  const name  = V(props, 'Name');
  return {
    id: p.id,
    name,
    sku:         V(props, 'SKU') || '',
    price:       V(props, 'Price') || 0,
    image:       V(props, 'Image') || '',
    logo:        V(props, 'Logo')  || '',
    category:    V(props, 'Category') || '',
    description: V(props, 'Description') || '',
    active:      V(props, 'Active') !== false,
    payment_url: V(props, 'PaymentURL') || ''
  };
}

// ---------- MAIN ----------
async function main(){
  try{
    const DB_ID = await resolveDatabaseId();
    console.log('[DEBUG] Using database ID:', DB_ID);

    // sanity check with helpful guidance if it fails
    try {
      const meta = await notion.databases.retrieve({ database_id: DB_ID });
      const title = meta?.title?.[0]?.plain_text || '(untitled)';
      console.log('[DEBUG] DB title:', title);
      console.log('[DEBUG] Properties:', Object.keys(meta.properties).join(', '));
    } catch (e) {
      const msg = e?.body?.message || e.message || String(e);
      console.error('\n[ERROR] Could not access the database. Common fixes:');
      console.error(' - Ensure THIS integration (token) is connected to the **source database** (Share → Connections).');
      console.error(' - If you’re on a Linked view, use **View source database** and that URL/ID.');
      console.error(' - Integration needs "Read content" and access to the parent page/teamspace.\n');
      throw new Error(msg);
    }

    const pages = await fetchAll(DB_ID);
    const items = pages.map(mapPage).filter(x => !!x.name);

    const outPath = path.join(__dirname, '..', 'data', 'products.json');
    fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
    console.log(`Wrote ${items.length} products → ${outPath}`);
  } catch (e){
    console.error(e);
    process.exit(1);
  }
}

main();