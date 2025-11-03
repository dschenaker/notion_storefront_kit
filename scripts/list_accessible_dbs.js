import dotenv from 'dotenv';
import { Client } from '@notionhq/client';
dotenv.config({ override:true });
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const rt = t => (t || []).map(x=>x.plain_text||'').join('').trim();
const clean = id => (id||'').replace(/-/g,'');
const main = async () => {
  let cursor=undefined, seen=0;
  do {
    const res = await notion.search({
      start_cursor: cursor,
      page_size: 100,
      filter: { property:'object', value:'database' },
      sort: { direction:'ascending', timestamp:'last_edited_time' }
    });
    for (const r of res.results) {
      console.log(`• "${rt(r.title)}" → ${clean(r.id)}`);
      seen++;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  console.log(`Total visible DBs: ${seen}`);
};
main().catch(e => { console.error(e.body?.message || e.message); process.exit(1); });
