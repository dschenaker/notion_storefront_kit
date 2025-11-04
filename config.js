window.STORE = {
  NAME: "CYS Official Storefront",
  CURRENCY: "USD",
  PRODUCTS_JSON: "data/products.json",
  CHECKOUT_MODE: "email", // "email" | "links"
  ORDER_EMAIL: "dschenaker@worldchangersusa.com",

// Choose exactly ONE of the two lines below to target CYS:
  SKU_PREFIX: "CYS-",            // simplest if all CYS SKUs start with "CYS-"
  // SKU_ALLOWLIST: ["CYS-Tablecloth", "CYS-Full-Zip-Female"], // or explicit list


  // NEW: where the "Sync Now" button should point
  REPO_OWNER: "dschenaker",
  REPO_NAME: "notion_storefront_kit",
  WORKFLOW_FILE: "sync.yml" // .github/workflows/sync.yml (already in this repo)
};