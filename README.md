# Kitsune Lite Storefront (Free, Static)

A zero-cost, portable storefront you can host on **GitHub Pages**. Data is a simple JSON file that can be auto-built nightly from a **Notion database** via GitHub Actions.

## What you get
- Mobile-first storefront (HTML/CSS/JS) — no frameworks
- Client-side cart (localStorage)
- Checkout via **email draft** (no processor fees) or per-product **payment links**
- Optional nightly **Notion → products.json** sync using GitHub Actions

## 1) Quick start (no Notion yet)
1. Click **Use this template** on GitHub or upload this folder as a new repo.
2. Edit `data/products.sample.json`, then duplicate it as `data/products.json`.
3. In `config.js`, set `NAME`, `CURRENCY`, and `CHECKOUT_MODE` (`email` or `links`).
4. Turn on GitHub Pages for the repo (Settings → Pages → `Deploy from a branch` → `main` → `/root`).
5. Visit your site: `https://<you>.github.io/<repo>`

## 2) Wire to Notion (free)
- Create a Notion database with the following properties:
  - **Name** (Title)
  - **Price** (Number)
  - **SKU** (Text)
  - **Image** (Files & media or URL)
  - **Category** (Select or Text)
  - **Active** (Checkbox)
  - **PaymentURL** (URL, optional)
- In the repo, go to Settings → Secrets and variables → Actions → **New repository secret**:
  - `NOTION_TOKEN` = your Notion integration secret
  - `NOTION_DB_ID` = your database ID
- In Notion, share the database with your integration (… → Connections).

### How it works
The Action (`.github/workflows/sync.yml`) runs `scripts/notion_sync.js` which reads your DB and writes `data/products.json`. Then it deploys your static site to GitHub Pages. **No servers**, **no bills**.

## 3) Checkout options
- **email (default):** creates an email draft to `ORDER_EMAIL` with a plain-text order. You can reply with an **Invoice Ninja** payment link or coordinate cash on delivery.
- **links:** if a product has `payment_url`, the **Buy** button opens it directly (Stripe Payment Link, PayPal, Invoice Ninja public page, etc.).

## Local development
Just open `index.html` in a browser, or run any static server (e.g., `python3 -m http.server`).

## File overview
- `index.html` — storefront UI
- `styles.css` — minimal styling
- `config.js` — store name, currency, checkout mode
- `app.js` — products rendering, cart, checkout
- `data/products.json` — built file consumed by the app
- `scripts/notion_sync.js` — Notion → products.json
- `.github/workflows/sync.yml` — GitHub Action to sync + deploy

## Notes
- This kit avoids vendor lock-in: it’s just files. You can move it anywhere.
- If you don't want nightly syncs, delete the workflow. You can still push `data/products.json` manually.
