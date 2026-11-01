import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

const catalogPlugin = process.env.EMDASH_CATALOG_PLUGIN === "1";

// https://astro.build/config
export default defineConfig({
	output: "server",
	// Old static-site addresses (bakedbyerin.com/menu.html etc.) → new pages, so existing links keep working.
	redirects: {
		"/index.html": "/",
		"/menu.html": "/products",
		"/seasonal_menu.html": "/products?category=seasonal",
		"/passover_menu.html": "/products?category=passover",
		"/contact.html": "/contact",
		"/cart.html": "/order",
		"/gallery.html": "/products",
	},
	adapter: cloudflare(),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto", coalesce: true }),
			storage: r2({ binding: "MEDIA" }),
			// Friendly catalog manager for staff (runs in a sandboxed isolate).
			// Needs the Worker Loader binding, which is Workers Paid only. To turn it on:
			// uncomment worker_loaders in wrangler.jsonc and build with EMDASH_CATALOG_PLUGIN=1.
			...(catalogPlugin
				? {
						sandboxed: [
							{
								id: "catalog-manager",
								version: "0.1.0",
								format: "standard",
								entrypoint: "catalog-manager/sandbox",
								adminPages: [{ path: "/catalog", label: "Catalog", icon: "tag", group: "Shop" }],
							},
						],
						sandboxRunner: sandbox(),
					}
				: {}),
			// Set to the public origin once deployed (also accepted via EMDASH_SITE_URL env).
			// Production origin comes from EMDASH_SITE_URL (wrangler.jsonc vars); previews use the request origin.
		}),
	],
	devToolbar: { enabled: false },
});
