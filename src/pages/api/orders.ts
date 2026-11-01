import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";
import { withEmDashRuntime } from "emdash/middleware";
import { checkMinimums, parseMixins, type CartLine } from "../../lib/menu-rules";

/**
 * Public order submission. Validates input, recomputes the total from the
 * server's product prices (never trusts the client total), and writes the
 * order as a published `orders` content entry via the EmDash runtime.
 * Delivery (Miami) adds a flat fee; payment happens after Erin confirms.
 *
 * This is an internet-facing endpoint: it validates everything itself.
 */

const DELIVERY_FEE = 10;
// Orders need this many days' notice (order on Nov 1 → earliest Nov 4). Keep in sync with order/index.astro.
const LEAD_DAYS = 3;
// Erin's Formspree form: each order is emailed to her from here (the server), right after it's saved.
const FORMSPREE_URL = "https://formspree.io/f/xyknvwqq";

type OrderItem = { product: string; size?: string; mixin?: string; quantity: number; unit_price: number };

/** Sends the order to Formspree. Returns true when Formspree accepted it. Never throws. */
async function notifyErin(order: Record<string, any>, id: string, origin: string | null): Promise<boolean> {
	const items = (order.items as OrderItem[])
		.map((i) => {
			const extras = [i.size, i.mixin].filter(Boolean).join(", ");
			return `${i.quantity} × ${i.product}${extras ? ` (${extras})` : ""} — $${i.unit_price * i.quantity}`;
		})
		.join("\n");
	const site = origin && /^https:\/\/([a-z0-9-]+\.)*bakedbyerin\.com$/.test(origin) ? origin : "https://bakedbyerin.com";
	try {
		const res = await fetch(FORMSPREE_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				// Formspree's "restrict to domain" setting checks where the submission came from.
				Origin: site,
				Referer: `${site}/order`,
			},
			body: JSON.stringify({
				_subject: `New order from ${order.customer_name} (${id.slice(-6)})`,
				"Order Ref": id,
				Name: order.customer_name,
				Phone: order.customer_phone,
				// Erin's Formspree form requires a field named exactly "email" (also used as the reply-to).
				email: order.customer_email,
				"Pickup or Delivery": order.fulfillment,
				"Delivery Address": order.delivery_address || "",
				"Requested Date": order.requested_date,
				Items: items,
				"Delivery Fee": `$${order.delivery_fee}`,
				Total: `$${order.total}`,
				Notes: order.notes || "",
			}),
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) {
			console.error(`Formspree rejected order ${id}: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
			return false;
		}
		console.log(`Formspree accepted order ${id}`);
		return true;
	} catch (err) {
		console.error(`Formspree request failed for order ${id}: ${(err as Error).message}`);
		return false;
	}
}

export const POST: APIRoute = async ({ request }) => {
	if (request.method !== "POST") {
		return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
			status: 405,
			headers: { "Content-Type": "application/json" },
		});
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: "Invalid JSON body." }, 400);
	}

	const b = (body ?? {}) as Record<string, unknown>;
	const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
	const customer_name = str(b.customer_name, 120);
	const customer_email = str(b.customer_email, 200);
	const customer_phone = str(b.customer_phone, 40);
	const fulfillment = str(b.fulfillment, 20);
	const delivery_address = str(b.delivery_address, 500);
	const notes = str(b.notes, 2000);
	// <input type="date"> sends "YYYY-MM-DD". Store it as midday so it never shifts a day across time zones.
	const requested_date = /^\d{4}-\d{2}-\d{2}$/.test(str(b.pickup_date, 10)) ? str(b.pickup_date, 10) : "";
	const pickupMs = requested_date ? Date.parse(`${requested_date}T12:00:00Z`) : NaN;
	const pickup_date = Number.isNaN(pickupMs) ? "" : new Date(pickupMs).toISOString();
	const rawItems = Array.isArray(b.items) ? b.items.slice(0, 50) : [];

	if (!customer_name) return json({ ok: false, error: "Your name is required." }, 400);
	if (!customer_phone) return json({ ok: false, error: "A phone number is required so Erin can confirm your order." }, 400);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email))
		return json({ ok: false, error: "A valid email address is required so Erin can confirm your order." }, 400);
	if (!pickup_date) return json({ ok: false, error: "Please choose a date." }, 400);
	// Minimum notice, counted from today's date in Miami.
	const todayMiami = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
	const earliest = new Date(`${todayMiami}T12:00:00Z`);
	earliest.setUTCDate(earliest.getUTCDate() + LEAD_DAYS);
	const earliestDate = earliest.toISOString().slice(0, 10);
	if (requested_date < earliestDate) {
		const nice = earliest.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
		return json({ ok: false, error: `Orders need at least ${LEAD_DAYS} days' notice. The earliest available date is ${nice}.` }, 400);
	}
	if (!["pickup", "delivery"].includes(fulfillment)) return json({ ok: false, error: "Choose pickup or delivery." }, 400);
	if (fulfillment === "delivery" && !delivery_address)
		return json({ ok: false, error: "A delivery address is required for delivery." }, 400);
	if (rawItems.length === 0) return json({ ok: false, error: "Your cart is empty." }, 400);

	// Resolve products, sizes, mix-ins and prices from the server. Never trust client prices.
	const { entries: products } = await getEmDashCollection("products", {
		status: "published",
		limit: 100,
	});
	type Prod = { title: string; price: number; price_large: number | null; mixins: string[]; mixinsOptional: boolean; category: string | null; available: boolean };
	const bySlug = new Map<string, Prod>();
	for (const p of products) {
		if (typeof p.data.price !== "number") continue;
		bySlug.set(p.id, {
			title: p.data.title,
			price: p.data.price,
			price_large: typeof p.data.price_large === "number" && p.data.price_large > 0 ? p.data.price_large : null,
			mixins: parseMixins(p.data.mixins).choices,
			mixinsOptional: parseMixins(p.data.mixins).optional,
			category: p.data.terms?.category?.[0]?.slug ?? null,
			available: p.data.available !== false,
		});
	}

	const items: Array<{ product: string; size?: string; mixin?: string; quantity: number; unit_price: number }> = [];
	const ruleLines: CartLine[] = [];
	let subtotal = 0;
	for (const raw of rawItems) {
		const it = (raw ?? {}) as Record<string, unknown>;
		const slug = str(it.product, 200);
		const size = str(it.size, 10);
		const mixin = str(it.mixin, 60);
		const quantity = Number(it.quantity);
		const prod = bySlug.get(slug);
		if (!prod || !prod.available) return json({ ok: false, error: `Sorry, ${prod?.title ?? "an item in your cart"} isn't available right now.` }, 400);
		if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 99) return json({ ok: false, error: `Invalid quantity for ${prod.title}.` }, 400);
		if (size && !(size === "Small" || (size === "Large" && prod.price_large))) return json({ ok: false, error: `Invalid size for ${prod.title}.` }, 400);
		if (prod.mixins.length > 0 && !prod.mixinsOptional && !prod.mixins.includes(mixin)) return json({ ok: false, error: `Please pick a mix-in for ${prod.title}.` }, 400);
		if (prod.mixinsOptional && mixin && !prod.mixins.includes(mixin)) return json({ ok: false, error: `Invalid add-on for ${prod.title}.` }, 400);
		if (prod.mixins.length === 0 && mixin) return json({ ok: false, error: `${prod.title} doesn't take mix-ins.` }, 400);
		const unit_price = size === "Large" && prod.price_large ? prod.price_large : prod.price;
		items.push({ product: prod.title, size: size || undefined, mixin: mixin || undefined, quantity, unit_price });
		ruleLines.push({ category: prod.category, size, quantity });
		subtotal += unit_price * quantity;
	}
	const minimumError = checkMinimums(ruleLines);
	if (minimumError) return json({ ok: false, error: minimumError }, 400);
	const delivery_fee = fulfillment === "delivery" ? DELIVERY_FEE : 0;
	const total = Math.round((subtotal + delivery_fee) * 100) / 100;

	try {
		const id = await withEmDashRuntime(async (runtime) => {
			const created = await runtime.handleContentCreate("orders", {
				data: {
					customer_name,
					customer_email: customer_email || undefined,
					customer_phone: customer_phone || undefined,
					pickup_date,
					fulfillment,
					delivery_address: delivery_address || undefined,
					items,
					delivery_fee,
					total,
					notes: notes || undefined,
					payment_method: "pay-after-confirmation",
					order_status: "new",
				},
				// Published content needs a slug; orders aren't public pages, so any unique value works.
				slug: `order-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
				status: "published",
			});
			if ((created as any).error) throw new Error(`create failed: ${JSON.stringify((created as any).error)}`);
			const createdId = (created as any).data?.item?.id;
			if (!createdId) throw new Error("create returned no id");
			// Publish so the order shows immediately in the admin.
			await runtime.handleContentPublish("orders", createdId);
			return createdId;
		});
		const order = { customer_name, customer_phone, customer_email, fulfillment, delivery_address, requested_date, items, delivery_fee, total, notes };
		const notified = await notifyErin(order, String(id), request.headers.get("origin"));
		// If the server couldn't reach Formspree, the browser tries once as a fallback.
		return json({ ok: true, id, notified, order }, 201);
	} catch (err) {
		return json({ ok: false, error: `Could not save your order: ${(err as Error).message}` }, 500);
	}
};

function json(obj: unknown, status: number): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
