// Notion → data/products.json
// Usage in GitHub Action (with secrets): NOTION_TOKEN, NOTION_DB_ID
// Local usage: create a .env (NOTION_TOKEN=..., NOTION_DB_ID=...) then: node scripts/notion_sync.js
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.NOTION_DB_ID;

if(!NOTION_TOKEN || !DB_ID){
  console.error('Missing NOTION_TOKEN or NOTION_DB_ID');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

function richTextToPlain(rt){
  return (rt||[]).map(r=>r.plain_text||'').join('');
}

function firstFileUrl(files){
  if(!files || !files.length) return '';
  const f = files[0];
  if(f.type==='file') return f.file.url;
  if(f.type==='external') return f.external.url;
  return '';
}

function prop(props, key){
  return props[key];
}

function val(props, key){
  const p = props[key];
  if(!p) return null;
  switch(p.type){
    case 'title': return richTextToPlain(p.title);
    case 'rich_text': return richTextToPlain(p.rich_text);
    case 'number': return p.number;
    case 'checkbox': return p.checkbox;
    case 'select': return p.select? p.select.name : null;
    case 'url': return p.url;
    case 'files': return firstFileUrl(p.files);
    default: return null;
  }
}

async function fetchAll(){
  const all = [];
  let cursor = undefined;
  while(true){
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100
    });
    all.push(...res.results);
    if(!res.has_more) break;
    cursor = res.next_cursor;
  }
  return all;
}

function mapPage(p){
  const props = p.properties||{};
  const name = val(props,'Name');
  return {
    id: p.id,
    name,
    sku: val(props,'SKU') || '',
    price: val(props,'Price') || 0,
    image: val(props,'Image') || '',
    category: val(props,'Category') || '',
    description: val(props,'Description') || '',
    active: val(props,'Active')!==false,
    payment_url: val(props,'PaymentURL') || ''
  };
}

(async function main(){
  try{
    const pages = await fetchAll();
    const items = pages.map(mapPage).filter(x=>!!x.name);
    const outPath = path.join(__dirname, '..', 'data', 'products.json');
    fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
    console.log(`Wrote ${items.length} products → ${outPath}`);
  }catch(e){
    console.error(e);
    process.exit(1);
  }
})();