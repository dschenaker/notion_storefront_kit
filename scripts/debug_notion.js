import 'dotenv/config';
import { Client } from '@notionhq/client';

const token = process.env.NOTION_TOKEN;
const claimed = (process.env.NOTION_DB_ID || '').trim();
const notion = new Client({ auth: token });

console.log('[DEBUG] token present:', !!token);
console.log('[DEBUG] claimed DB id:', claimed);

try {
  // Try to retrieve the claimed DB first
  const meta = await notion.databases.retrieve({ database_id: claimed });
  console.log('[DEBUG] retrieve OK. Title:', meta?.title?.[0]?.plain_text || '(untitled)');
  console.log('[DEBUG] Properties:', Object.keys(meta.properties).join(', '));
} catch (e) {
  console.warn('[WARN] retrieve failed for claimed id:', e.body?.message || e.message);
  // Fall back: search for databases visible to this integration
  const q = await notion.search({ query: 'Product', filter: { value: 'database', property: 'object' } });
  const dbs = q.results.map(r => ({ id: r.id.replace(/-/g,''), title: r.title?.[0]?.plain_text || '(untitled)' }));
  console.log('[DEBUG] Databases visible to this token:');
  dbs.forEach(d => console.log('  •', d.title, '→', d.id));
  process.exit(1);
}