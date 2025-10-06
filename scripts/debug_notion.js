// @ts-nocheck
import dotenv from 'dotenv';
import { Client } from '@notionhq/client';
dotenv.config({ override: true });

const token  = process.env.NOTION_TOKEN || '';
const claimed = (process.env.NOTION_DB_ID || '').trim();
const notion = new Client({ auth: token });

(async () => {
  console.log('[DEBUG] token present:', !!token);
  console.log('[DEBUG] claimed DB id:', claimed || '(none)');

  try {
    if (claimed) {
      const meta = await notion.databases.retrieve({ database_id: claimed });
      console.log('[DEBUG] retrieve OK. Title:', meta?.title?.[0]?.plain_text || '(untitled)');
      console.log('[DEBUG] Properties:', Object.keys(meta.properties).join(', '));
    } else {
      console.log('[WARN] No NOTION_DB_ID set; skipping retrieve test.');
    }
  } catch (e) {
    console.warn('[WARN] retrieve failed for claimed id:', e.body?.message || e.message);
  }

  try {
    const res = await notion.databases.query({
      database_id: claimed, page_size: 3
    });
    console.log('[DEBUG] query ok. Sample count:', res.results.length);
  } catch (e) {
    console.error('[ERROR] databases.query failed\n', e.body || e.message || e);
    process.exit(1);
  }
})();