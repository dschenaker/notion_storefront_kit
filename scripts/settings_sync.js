// Notion "Store Settings" -> data/settings.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const SETTINGS_DB  = (process.env.NOTION_SETTINGS_DB_ID || '').replace(/-/g,'').trim();
const SETTINGS_URL = (process.env.NOTION_SETTINGS_DB_URL || '').trim();

if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN');
  process.exit(1);
}
if (!SETTINGS_DB && !SETTINGS_URL){
  console.error('Provide NOTION_SETTINGS_DB_ID or NOTION_SETTINGS_DB_URL');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

function extractIdFromUrl(url){
  const m = (url||'').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}
const DB_ID = SETTINGS_DB || extractIdFromUrl(SETTINGS_URL);

function rtToText(r){ return (r||[]).map(x=>x.plain_text||'').join('').trim(); }
function firstFileUrl(files){
  const f = (files||[])[0];
  if (!f) return '';
  if (f.type === 'file')   return f.file?.url || '';
  if (f.type === 'external') return f.external?.url || '';
  return '';
}

const OUT = path.join(__dirname, '..', 'data', 'settings.json');

(async () => {
  try{
    const pages = await notion.databases.query({ database_id: DB_ID, page_size: 1 });
    if (!pages.results.length){
      throw new Error('Settings DB has no rows');
    }
    const p = pages.results[0].properties;

    // Map your exact column names:
    const hero_title   = rtToText(p['Hero Title']?.title || p['Hero Title']?.rich_text);
    const hero_sub     = rtToText(p['Hero Subtitle']?.rich_text);
    const background   = firstFileUrl(p['Background']?.files);
    const theme        = p['Theme']?.select?.name || '';
    const price_mult   = (typeof p['Price Multiplier']?.number === 'number') ? p['Price Multiplier'].number : 1;
    const primary_color= rtToText(p['Primary Color']?.rich_text);

    const settings = {
      hero_title: hero_title || '',
      hero_subtitle: hero_sub || '',
      background_url: background || '',
      theme: (theme || '').toLowerCase(), // "dark" / "light"
      price_multiplier: price_mult || 1,
      primary_color: primary_color || ''
    };

    fs.mkdirSync(path.join(__dirname,'..','data'), { recursive:true });
    fs.writeFileSync(OUT, JSON.stringify(settings, null, 2));
    console.log('Wrote', OUT, '\n', settings);
  }catch(e){
    console.error('Settings sync failed:', e.body?.message || e.message || e);
    process.exit(1);
  }
})();