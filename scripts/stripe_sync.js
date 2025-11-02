import Stripe from "stripe";
import fs from "fs";
import { Client } from "@notionhq/client";

const STRIPE_KEY = process.env.STRIPE_API_KEY;
const MODE = (process.env.STRIPE_MODE || "test").toLowerCase();
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;

if (!STRIPE_KEY) throw new Error("❌ Missing STRIPE_API_KEY");
if (!NOTION_TOKEN) throw new Error("❌ Missing NOTION_TOKEN");
if (!NOTION_DB_ID) throw new Error("❌ Missing NOTION_DB_ID");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });
const notion = new Client({ auth: NOTION_TOKEN });
const LINK_PROP = MODE === "live" ? "PaymentURL" : "Stripe Link (Test)";

console.log(`🔗 Running Stripe sync in [${MODE.toUpperCase()}] mode`);
console.log(`→ Writing links to Notion field: ${LINK_PROP}`);

const productsFile = "data/products.json";
if (!fs.existsSync(productsFile)) {
  throw new Error("❌ data/products.json not found.");
}

const products = JSON.parse(fs.readFileSync(productsFile, "utf8"));

async function syncProducts() {
  let created = 0,
    updated = 0,
    skipped = 0;

  for (const product of products) {
    const name = product["Product Name"] || product["Name"];
    if (!name) continue;

    console.log(`\n🛍 Processing: ${name}`);

    // Get current link field
    const existingLink = product[LINK_PROP];
    if (existingLink && existingLink.url) {
      console.log(`↩️ Skipping (already has link)`);
      skipped++;
      continue;
    }

    // Create or retrieve Stripe Product
    const stripeProduct = await findOrCreateProduct(name);
    const price = await ensurePrice(stripeProduct);
    const link = await createPaymentLink(price);

    // Update Notion
    await updateNotion(product.id, link.url);

    console.log(`✅ Created link: ${link.url}`);
    created++;
  }

  console.log(`\n✨ Done! Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
}

async function findOrCreateProduct(name) {
  const search = await stripe.products.list({ limit: 1, active: true, name });
  if (search.data.length > 0) return search.data[0];
  console.log("➕ Creating Stripe product");
  return await stripe.products.create({ name });
}

async function ensurePrice(product) {
  const prices = await stripe.prices.list({ product: product.id, active: true });
  if (prices.data.length > 0) return prices.data[0];
  console.log("💲 Creating default price");
  return await stripe.prices.create({
    unit_amount: 1000, // default $10 placeholder
    currency: "usd",
    product: product.id,
  });
}

async function createPaymentLink(price) {
  return await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
  });
}

async function updateNotion(pageId, linkUrl) {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        [LINK_PROP]: { url: linkUrl },
      },
    });
  } catch (err) {
    console.error("⚠️ Failed to update Notion page:", pageId, err.message);
  }
}

syncProducts().catch((err) => {
  console.error("❌ Stripe sync failed:", err);
  process.exit(1);
});