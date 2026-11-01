# Baked by Erin 🧁

An EmDash CMS shop on Cloudflare Workers at **bakedbyerin.com** — customers order
online and pay after Erin confirms. Based on the `banana-shop` EmDash template.

## Stack

- [EmDash](https://emdashcms.com) — Astro-native CMS (`emdash@1.4.0`)
- Astro 7 with the Cloudflare adapter (`output: server`)
- Cloudflare Workers + D1 (database) + R2 (photos/media)
- A sandboxed **catalog-manager** plugin so staff can add products without the full editor

## What you need first

1. A Cloudflare account (the free plan works; the optional Catalog page needs **Workers Paid**, see note below).
2. **bakedbyerin.com added to that Cloudflare account** as a zone, with the
   nameservers at your registrar pointed to Cloudflare. The custom-domain deploy
   fails until the zone is active.
3. Node 20+ and pnpm (`npm i -g pnpm`).

## Quick setup (Windows)

Run `powershell -ExecutionPolicy Bypass -File .\setup.ps1` in this folder. It does Steps 1–4 for you.

## Step 1 — Install and log in

```bash
pnpm install
npx wrangler login
```

## Step 2 — Create the database and storage (one time)

```bash
# Production
npx wrangler d1 create baked-by-erin
npx wrangler r2 bucket create baked-by-erin-media

# Previews (separate, so test orders never reach the real shop)
npx wrangler d1 create baked-by-erin-preview
npx wrangler r2 bucket create baked-by-erin-preview-media
```

Each `d1 create` prints a `database_id`. Paste them into `wrangler.jsonc`:

- `REPLACE_WITH_PROD_D1_ID` → ID from `baked-by-erin`
- `REPLACE_WITH_PREVIEW_D1_ID` → ID from `baked-by-erin-preview`

## Step 3 — Try it locally

```bash
pnpm dev                                   # http://localhost:4321
                                           # admin: http://localhost:4321/_emdash/admin
npx emdash seed seed/seed.json --validate  # loads sample products
```

`seed/seed.json` holds Erin's real menu (breads, cakes, granola, seasonal and
Passover items, with photos pulled from bakedbyerin.com). On the live site, choose
**sample content** in the first-run setup wizard at `/_emdash/admin` to load it.

## Step 4 — Secrets and first deploy

```bash
npx wrangler secret put EMDASH_ENCRYPTION_KEY   # value: output of `npx emdash secrets generate`
npx wrangler secret put EMDASH_AUTH_SECRET      # value: output of `openssl rand -hex 32`
pnpm deploy                                     # creates the Worker + shop.bakedbyerin.com
```

Preview Worker (optional):

```bash
CLOUDFLARE_ENV=preview pnpm build && npx wrangler deploy
npx wrangler secret put EMDASH_ENCRYPTION_KEY --name baked-by-erin-preview
npx wrangler secret put EMDASH_AUTH_SECRET    --name baked-by-erin-preview
```

Then visit https://shop.bakedbyerin.com/_emdash/admin to create the admin account.

## Step 5 — Auto-deploy from GitHub (optional)

Cloudflare Dashboard → Workers → *worker* → Settings → Builds → Connect, and
point it at **your** repo.

**`baked-by-erin`** (production)
- Production branch: `main`
- Build command: `pnpm build`
- Deploy command: `npx wrangler deploy`
- Non-production branch builds: **off**

**`baked-by-erin-preview`** (branch previews)
- Build variable: `CLOUDFLARE_ENV=preview`
- Build command: `pnpm build`
- Deploy command: `npx wrangler versions upload`
- Non-production branch builds: **on**, deploy command `npx wrangler versions upload`

The Astro adapter picks the env from `CLOUDFLARE_ENV` at build time, so **don't**
pass `--env` to wrangler afterwards.

> **Note:** the Catalog admin page (catalog-manager plugin) needs the Worker
> Loader binding, which is Workers Paid only, so it is **off** by default. Products
> are managed at `/_emdash/admin/content/products`. To turn it on after upgrading:
> uncomment the two `worker_loaders` lines in `wrangler.jsonc` and build with
> `EMDASH_CATALOG_PLUGIN=1` (PowerShell: `$env:EMDASH_CATALOG_PLUGIN="1"; pnpm deploy`;
> in Workers Builds, add it as a build variable).

## Going live on bakedbyerin.com

`wrangler.jsonc` routes bakedbyerin.com, www.bakedbyerin.com and shop.bakedbyerin.com
to this Worker. Old static-site URLs (`menu.html`, `contact.html`, …) redirect to the
new pages (see `redirects` in `astro.config.mjs`).

First switch-over:

1. Dashboard → Workers & Pages → `bakedbyerin` (Pages) → Custom domains → remove
   `bakedbyerin.com` and `www.bakedbyerin.com`. (Optionally delete the Pages project
   or turn off its automatic deployments.)
2. `pnpm deploy`.

## Orders

Customers add items to a cart (sizes and mix-ins included), choose pickup or
Miami delivery (+$10), and check out at `/order`. `POST /api/orders` recalculates
every price on the server and saves the order in the EmDash `orders` collection,
and the browser also sends Erin the usual Formspree email. Payment (PayPal,
Venmo, CashApp, Zelle, cash or check) happens after Erin confirms. Update
`order_status` in the admin as orders move along.

## Editing the menu

In the admin, each product has: price (small size, or the only price), an
optional large-size price, highlights (one per line), mix-ins, a menu order
number, a photo, and an Available switch — turn that off for out-of-season items
like the Passover menu.

Mix-ins field:
- `Chocolate Chips, Peanut Butter Cups, Oreos` — the customer must pick one.
- `optional: Chocolate Chips` — a free add-on button the customer can skip.

Minimums (in `src/lib/menu-rules.ts`): at least 2 small (mini) breads, or 2 bags
of granola, when that's the only thing in the cart. Anything else in the cart
lifts the minimum.
