import type { SandboxedPlugin } from "emdash/plugin";
import type { BlockResponse } from "@emdash-cms/blocks";
import { z } from "zod";

/**
 * Catalog Manager — a friendly admin UI for staff to add and list shop products
 * (bakery items) without using the full content editor.
 *
 * Mounted at /_emdash/admin/plugins/catalog-manager/catalog. Reads the live
 * schema so it stays in sync with the `products` collection and `category`
 * taxonomy. New products are created published so they appear on the
 * storefront immediately. Photos are added in the full editor (the "Edit" link
 * in the table opens it).
 */

const COLLECTION = "products";
const TAXONOMY = "category";
const UNITS = ["loaf", "cake", "bag", "bottle", "box"] as const;

// --- Interactions from the admin host -------------------------------------

const interactionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("page_load"), page: z.string() }),
	z.object({
		type: z.literal("block_action"),
		action_id: z.string(),
		block_id: z.string().optional(),
		value: z.unknown().optional(),
	}),
	z.object({
		type: z.literal("form_submit"),
		action_id: z.string(),
		block_id: z.string().optional(),
		values: z.record(z.unknown()),
	}),
]);

// --- Types for the products we read back ----------------------------------

interface ProductRow {
	id: string;
	slug: string | null;
	status: string;
	title: string | null;
	price: number | null;
	price_large: number | null;
	unit: string | null;
	available: boolean | null;
	category: string | null;
}

interface Term {
	id: string;
	slug: string;
	label: string;
}

// --- Helpers --------------------------------------------------------------

function money(n: number | null | undefined): string {
	if (n == null) return "—";
	return `$${n.toFixed(2)}`;
}

function statusLabel(status: string): string {
	if (status === "published") return "Live";
	if (status === "draft") return "Draft";
	return status;
}

function categoryOptions(terms: Term[]) {
	return [{ label: "— None —", value: "" }, ...terms.map((t) => ({ label: t.label, value: t.id }))];
}

// --- Block builders -------------------------------------------------------

function listPage(rows: ProductRow[], terms: Term[], toast?: { type: "success" | "error"; message: string }): BlockResponse {
	const total = rows.length;
	const live = rows.filter((r) => r.status === "published").length;
	const hidden = rows.filter((r) => r.available === false).length;

	return {
		blocks: [
			{ type: "header", text: "Catalog" },
			{
				type: "context",
				text: "Add new bakery items here. New products go live on the storefront immediately. Use “Edit” to add a photo or change anything else.",
			},
			{
				type: "stats",
				items: [
					{ label: "Products", value: String(total) },
					{ label: "Live", value: String(live), trend: live === total && total > 0 ? "up" : "neutral" },
					{ label: "Hidden", value: String(hidden) },
				],
			},
			{ type: "divider" },
			{
				type: "actions",
				elements: [
					{ type: "button", label: "+ Add product", action_id: "new", style: "primary" },
					{ type: "button", label: "Refresh", action_id: "refresh" },
				],
			},
			{
				type: "table",
				columns: [
					{ key: "title", label: "Product" },
					{ key: "category", label: "Category" },
					{ key: "price", label: "Price" },
					{ key: "unit", label: "Unit" },
					{ key: "available", label: "Available" },
					{ key: "status", label: "Status", format: "badge" },
					{ key: "edit", label: "", format: "element" },
				],
				rows: rows.map((r) => ({
					title: r.title ?? "(untitled)",
					category: terms.find((t) => t.slug === r.category)?.label ?? "—",
					price: r.price_large != null ? `${money(r.price)} / ${money(r.price_large)}` : money(r.price),
					unit: r.unit ?? "—",
					available: r.available === false ? "No" : "Yes",
					status: statusLabel(r.status),
					edit: {
						type: "link",
						text: "Edit",
						href: `/_emdash/admin/content/${COLLECTION}/${r.id}`,
					},
				})),
				page_action_id: "browse",
				empty_text: "No products yet. Click “Add product” to create your first one.",
			},
		],
		toast,
	};
}

function newProductForm(terms: Term[], initial?: Record<string, unknown>): BlockResponse {
	return {
		blocks: [
			{ type: "header", text: "Add product" },
			{ type: "context", text: "Set the name, category, price, and availability. Add a photo afterwards in the full editor." },
			{
				type: "form",
				block_id: "new_product",
				fields: [
					{ type: "text_input", action_id: "title", label: "Name", placeholder: "e.g. Mango Bread", initial_value: typeof initial?.title === "string" ? initial.title : undefined },
					{
						type: "select",
						action_id: "category_id",
						label: "Category",
						options: categoryOptions(terms),
					},
					{ type: "number_input", action_id: "price", label: "Price (USD) — small size, or the only price", min: 0, initial_value: typeof initial?.price === "number" ? initial.price : undefined },
					{ type: "number_input", action_id: "price_large", label: "Large size price (optional)", min: 0, initial_value: typeof initial?.price_large === "number" ? initial.price_large : undefined },
					{
						type: "select",
						action_id: "unit",
						label: "Unit",
						options: UNITS.map((u) => ({ label: u, value: u })),
					},
					{ type: "text_input", action_id: "summary", label: "One-line summary", placeholder: "e.g. Tropical fruit bread, great any time.", initial_value: typeof initial?.summary === "string" ? initial.summary : undefined },
					{ type: "toggle", action_id: "available", label: "Available for order", initial_value: initial?.available !== false },
				],
				submit: { label: "Add & publish", action_id: "create" },
			},
			{
				type: "actions",
				elements: [{ type: "button", label: "← Back to catalog", action_id: "refresh" }],
			},
		],
	};
}

// --- Reading the catalog --------------------------------------------------

async function readRows(ctx: any): Promise<{ rows: ProductRow[]; terms: Term[] }> {
	const termsRaw = ctx.taxonomies ? await ctx.taxonomies.getTerms(TAXONOMY) : [];
	const terms: Term[] = (termsRaw ?? []).map((t: any) => ({ id: t.id, slug: t.slug, label: t.label }));

	const rows: ProductRow[] = [];
	if (!ctx.content) return { rows, terms };

	let cursor: string | undefined;
	do {
		const page = await ctx.content.list(COLLECTION, { limit: 100, cursor, orderBy: { updated_at: "desc" } as any });
		// Per-entry term lookup (small catalogs).
		const termMap: Record<string, string[]> = {};
		if (ctx.taxonomies) {
			for (const item of page.items) {
				try {
					const t = await ctx.taxonomies.getEntryTerms?.(COLLECTION, item.id, { taxonomy: TAXONOMY } as any);
					termMap[item.id] = (t ?? []).map((x: any) => x.slug);
				} catch {
					termMap[item.id] = [];
				}
			}
		}

		for (const item of page.items) {
			const d = item.data ?? {};
			rows.push({
				id: item.id,
				slug: item.slug,
				status: item.status,
				title: (d.title as string) ?? null,
				price: (d.price as number) ?? null,
				price_large: (d.price_large as number) ?? null,
				unit: (d.unit as string) ?? null,
				available: d.available === false ? false : true,
				category: termMap[item.id]?.[0] ?? null,
			});
		}
		cursor = page.nextCursor as string | undefined;
	} while (cursor);

	return { rows, terms };
}

// --- Plugin ---------------------------------------------------------------

const plugin: SandboxedPlugin = {
	routes: {
		admin: {
			permission: "plugins:manage",
			handler: async (routeCtx, ctx) => {
				const parsed = interactionSchema.safeParse(routeCtx.input);
				if (!parsed.success) {
					return {
						blocks: [
							{ type: "header", text: "Catalog" },
							{ type: "banner", title: "Bad request", variant: "error" },
						],
					} as BlockResponse;
				}
				const interaction = parsed.data;

				// Create a new product from the form.
				if (interaction.type === "form_submit" && interaction.action_id === "create") {
					const v = interaction.values as Record<string, unknown>;
					const title = typeof v.title === "string" ? v.title.trim() : "";
					const price = typeof v.price === "number" ? v.price : Number(v.price);
					if (!title || !Number.isFinite(price) || price < 0) {
						const { terms } = await readRows(ctx);
						return {
							...newProductForm(terms, v),
							toast: { type: "error", message: "Name and a valid price are required." },
						} as BlockResponse;
					}
					try {
						if (!ctx.content?.create) throw new Error("content write not available");
						const unit = typeof v.unit === "string" && (UNITS as readonly string[]).includes(v.unit) ? v.unit : UNITS[0];
						const summary = typeof v.summary === "string" ? v.summary : "";
						const available = v.available !== false;

						const data: Record<string, unknown> = { title, price, unit, available };
						if (summary) data.summary = summary;
						const priceLarge = typeof v.price_large === "number" ? v.price_large : Number(v.price_large);
						if (v.price_large != null && v.price_large !== "" && Number.isFinite(priceLarge) && priceLarge > 0) data.price_large = priceLarge;

						const created = await ctx.content.create(COLLECTION, data);

						// Publish immediately so it shows on the storefront.
						const versioned = await ctx.content.getVersioned?.(COLLECTION, created.id);
						if (versioned && ctx.content.publish) {
							await ctx.content.publish(COLLECTION, created.id, { _rev: versioned._rev });
						}

						// Assign the chosen category term, if any.
						const categoryId = typeof v.category_id === "string" ? v.category_id : "";
						if (categoryId && ctx.taxonomies?.addEntryTerms) {
							await ctx.taxonomies.addEntryTerms(COLLECTION, created.id, TAXONOMY, [categoryId]);
						}

						const { rows, terms } = await readRows(ctx);
						return listPage(rows, terms, { type: "success", message: `“${title}” added and published.` });
					} catch (err) {
						ctx.log.error("catalog-manager create failed", { error: String(err) });
						const { terms } = await readRows(ctx);
						return {
							...newProductForm(terms, v),
							toast: { type: "error", message: "Could not save. Check the form and try again." },
						} as BlockResponse;
					}
				}

				// "New product" button → show the form.
				if (interaction.type === "block_action" && interaction.action_id === "new") {
					const { terms } = await readRows(ctx);
					return newProductForm(terms);
				}

				// Refresh / browse / back → list page.
				const { rows, terms } = await readRows(ctx);
				return listPage(rows, terms);
			},
		},
	},
};

export default plugin;
