// scripts/settings_sync.js
// Export a single-row "Store Settings" Notion DB → data/settings.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const RAW_DB_ID    = (process.env.NOTION_SETTINGS_DB_ID || '').trim();
const RAW_DB_URL   = (process.env.NOTION_SETTINGS_DB_URL || '').trim();
const DB_NAME_HINT = (process.env.NOTION_SETTINGS_DB_NAME || '').trim();

if (!NOTION_TOKEN) {
  console.error('Missing NOTION_TOKEN for settings_sync');
  process.exit(1);
}
const notion = new Client({ auth: NOTION_TOKEN });

function extractIdFromUrl(url) {
  const m = (url || '').match(/[0-9a-f]{32}/i);
  return m ? m[0] : '';
}
async function resolveDatabaseId() {
  if (RAW_DB_ID) return RAW_DB_ID.replace(/-/g, '');
  const fromUrl = extractIdFromUrl(RAW_DB_URL);
  if (fromUrl) return fromUrl.toLowerCase();
  if (DB_NAME_HINT) {
    const search = await notion.search({
      query: DB_NAME_HINT,
      filter: { property: 'object', value: 'database' }
    });
    const hit = search.results?.[0];
    if (hit?.id) return hit.id.replace(/-/g,'');
  }
  throw new Error('Could not resolve settings database. Provide NOTION_SETTINGS_DB_ID or NOTION_SETTINGS_DB_URL.');
}

function rtToText(rt=[]) {
  return (rt || []).map(t => t.plain_text || '').join('').trim();
}
function firstFileUrl(files=[]) {
  const f = (files || [])[0];
  if (!f) return '';
  if (f.type === 'file') return f.file?.url || '';
  if (f.type === 'external') return f.external?.url || '';
  return '';
}

(async () => {
  try {
    const dbid = await resolveDatabaseId();
    // get first page (any)
    const q = await notion.databases.query({ database_id: dbid, page_size: 1 });
    const row = q.results?.[0];
    if (!row) throw new Error('Settings DB has no rows');

    const p = row.properties || {};
    const settings = {
      hero_title:        rtToText(p['Hero Title']?.title),
      hero_subtitle:     rtToText(p['Hero Subtitle']?.rich_text),
      background_url:    firstFileUrl(p['Background']?.files),
      theme:             p['Theme']?.select?.name || '',
      price_multiplier:  Number(p['Price Multiplier']?.number || 1),
      primary_color:     rtToText(p['Primary Color']?.rich_text) || '',
      notion_settings_url: RAW_DB_URL || ''
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