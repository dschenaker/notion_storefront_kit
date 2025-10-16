// Notion "Store Settings" -> data/settings.json
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override:true });
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const RAW_ID  = (process.env.NOTION_SETTINGS_DB_ID || '').trim();
const RAW_URL = (process.env.NOTION_SETTINGS_DB_URL || '').trim();

if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

const extractIdFromUrl = (url) => {
  const m = (url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
};

const toDashed = (id32) => {
  const s = (id32 || '').replace(/-/g,'').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return ''; // invalid
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
};

const id32 = (RAW_ID ? RAW_ID.replace(/-/g,'') : extractIdFromUrl(RAW_URL));
const DB_ID = toDashed(id32);  // <-- ensure dashed UUID

if (!DB_ID) {
  console.error('Provide NOTION_SETTINGS_DB_ID or NOTION_SETTINGS_DB_URL');
  process.exit(1);
}

const rtToText = (r=[]) => (r||[]).map(x=>x.plain_text||'').join('').trim();
const firstFileUrl = (files=[]) => {
  const f = files[0];
  if (!f) return '';
  if (f.type === 'file')     return f.file?.url || '';
  if (f.type === 'external') return f.external?.url || '';
  return '';
};

(async () => {
  try {
    const q = await notion.databases.query({ database_id: DB_ID, page_size: 1 });

    if (!q.results.length) throw new Error('Settings DB has no rows');
    const p = q.results[0].properties || {};

    const settings = {
      hero_title:       rtToText(p['Hero Title']?.title || p['Hero Title']?.rich_text),
      hero_subtitle:    rtToText(p['Hero Subtitle']?.rich_text),
      background_url:   firstFileUrl(p['Background']?.files),
      theme:           (p['Theme']?.select?.name || '').toLowerCase(),
      price_multiplier: Number(p['Price Multiplier']?.number ?? 1),
      primary_color:    rtToText(p['Primary Color']?.rich_text) || ''
    };

    const outDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'settings.json'), JSON.stringify(settings, null, 2));
    console.log('✅ Wrote data/settings.json');
  } catch (e) {
    console.error('❌ Settings sync failed:', e.body?.message || e.message || e);
    process.exit(1);
  }
})();