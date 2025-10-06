import 'dotenv/config';
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const res = await notion.search({ filter: { property: 'object', value: 'database' } });
for (const r of res.results) {
  const id = (r.id || '').replace(/-/g, '');
  const title = r.title?.[0]?.plain_text || '(untitled)';
  console.log(`${title} → ${id}`);
}