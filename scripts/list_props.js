import dotenv from 'dotenv';
import { Client } from '@notionhq/client';

dotenv.config({ override:true });

const token = process.env.NOTION_TOKEN?.trim();
const dbidRaw = (process.env.NOTION_DB_ID || '').replace(/-/g,'');
const dburl = process.env.NOTION_DB_URL || '';
const m = dburl.match(/[0-9a-f]{32}/i);
const dbid = (dbidRaw || (m ? m[0] : '')).toLowerCase();

if (!token || !dbid) {
  console.error('Set NOTION_TOKEN and NOTION_DB_ID or NOTION_DB_URL');
  process.exit(1);
}

const notion = new Client({ auth: token });

const dash = dbid.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');

const typeName = (p)=>p?.type || '?';

(async () => {
  const meta = await notion.databases.retrieve({ database_id: dash });
  const title = meta?.title?.[0]?.plain_text || '(untitled)';
  console.log('DB:', title);
  console.log('Properties:');
  for (const [k,v] of Object.entries(meta.properties||{})) {
    console.log(` - ${k} <${typeName(v)}>`);
  }
})();