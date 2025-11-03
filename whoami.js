import dotenv from 'dotenv';
import { Client } from '@notionhq/client';
dotenv.config();

const token = process.env.NOTION_TOKEN;
if (!token) { console.error('Missing NOTION_TOKEN'); process.exit(1); }

const notion = new Client({ auth: token });

const main = async () => {
  const me = await notion.users.me();
  // @notionhq/client returns bot user with workspace info
  console.log('BOT USER:');
  console.log(JSON.stringify(me, null, 2));
};
main().catch(e => { console.error(e.body?.message || e.message); process.exit(1); });
