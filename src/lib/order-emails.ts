// Order emails sent through the shop's email provider (Settings → Email → SMTP / Gmail):
//  1. New order  → Erin, right away (src/pages/api/orders.ts).
//  2. Confirmed  → the customer, a few minutes after Erin sets the order to "confirmed"
//                  (scheduled job, src/pages/api/tasks/review-emails.ts).
// Edit the wording here.

/** Where new-order notifications go. */
export const ORDER_NOTIFY_EMAIL = "getbakedbyerin@gmail.com";

/** Statuses that count as "Erin approved it" for the confirmation email. */
export const CONFIRMED_STATUSES = ["confirmed", "paid", "ready", "completed"];

const DAY = 24 * 60 * 60 * 1000;

type Item = { product: string; size?: string; mixin?: string; quantity: number; unit_price: number };

const money = (n: unknown) => {
	const v = Number(n) || 0;
	return `$${Number.isInteger(v) ? v : v.toFixed(2)}`;
};
const esc = (s: unknown) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function itemLines(order: Record<string, any>): string[] {
	return ((order.items as Item[]) ?? []).map((i) => {
		const extras = [i.size, i.mixin].filter(Boolean).join(", ");
		return `${i.quantity} × ${i.product}${extras ? ` (${extras})` : ""} — ${money(i.unit_price * i.quantity)}`;
	});
}

/** "Friday, November 20" from the stored pickup date (saved as midday UTC). */
export function niceDate(order: Record<string, any>): string {
	const raw = order.requested_date || order.pickup_date;
	const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? `${raw}T12:00:00Z` : String(raw));
	return Number.isNaN(d.getTime())
		? String(raw ?? "")
		: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function whenLine(order: Record<string, any>): string {
	return order.fulfillment === "delivery"
		? `Delivery on ${niceDate(order)} to ${order.delivery_address || "(no address given)"}`
		: `Pickup on ${niceDate(order)}`;
}

function totalsLines(order: Record<string, any>): string[] {
	const lines: string[] = [];
	if (Number(order.delivery_fee) > 0) lines.push(`Delivery fee: ${money(order.delivery_fee)}`);
	lines.push(`Total: ${money(order.total)}`);
	return lines;
}

function htmlWrap(inner: string): string {
	return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2d2d2d;max-width:560px">${inner}</div>`;
}

/** 1. New order notification for Erin. Replying goes to the customer. */
export function newOrderEmail(order: Record<string, any>, id: string, siteUrl: string) {
	const site = siteUrl.replace(/\/$/, "");
	const kind = order.fulfillment === "delivery" ? "delivery" : "pickup";
	const subject = `New order: ${order.customer_name} — ${niceDate(order)} (${kind}) — ${money(order.total)}`;
	const lines = [
		`New order from ${order.customer_name}`,
		"",
		`Phone: ${order.customer_phone || "-"}`,
		`Email: ${order.customer_email || "-"}`,
		whenLine(order),
		"",
		...itemLines(order),
		...totalsLines(order),
		"",
		order.notes ? `Customer notes: ${order.notes}` : "Customer notes: (none)",
		"",
		`Order ref: ${id}`,
		`To confirm it, open Orders in the admin, set the status to "confirmed" (add a note to the customer if you like) and save: ${site}/_emdash/admin`,
		"Reply to this email to write to the customer directly.",
	];
	const html = htmlWrap(`
<h2 style="color:#8b4513;margin:0 0 8px">New order from ${esc(order.customer_name)}</h2>
<p style="margin:0 0 12px"><strong>${esc(whenLine(order))}</strong><br>
Phone: ${esc(order.customer_phone || "-")}<br>Email: ${esc(order.customer_email || "-")}</p>
<ul style="padding-left:20px;margin:0 0 8px">${itemLines(order).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p style="margin:0 0 12px">${totalsLines(order).map(esc).join("<br>")}</p>
<p style="margin:0 0 12px"><em>Customer notes:</em> ${esc(order.notes || "(none)")}</p>
<p style="margin:0 0 12px"><a href="${site}/_emdash/admin" style="display:inline-block;background:#8b4513;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold">Open the admin</a></p>
<p style="color:#6b7280;font-size:13px;margin:0">To confirm: Orders → this order → status "confirmed" → Save. The customer gets a confirmation email within a few minutes.<br>Reply to this email to write to the customer. Order ref: ${esc(id)}</p>`);
	return { to: ORDER_NOTIFY_EMAIL, replyTo: order.customer_email || undefined, subject, text: lines.join("\n"), html };
}

/** Whether the customer's confirmation email should go out now. */
export function confirmationDue(order: Record<string, any>, now = Date.now()): boolean {
	if (!CONFIRMED_STATUSES.includes(order.order_status)) return false;
	if (order.confirmation_email_sent) return false;
	if (!order.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email)) return false;
	// Skip orders whose date is long past (so switching this on doesn't email old customers).
	const pickup = Date.parse(String(order.pickup_date ?? ""));
	return !Number.isNaN(pickup) && pickup >= now - 2 * DAY;
}

/** 2. Order confirmation for the customer, sent after Erin approves the order. */
export function confirmationEmail(order: Record<string, any>, id: string) {
	const first = String(order.customer_name ?? "").trim().split(/\s+/)[0] || "there";
	const note = String(order.confirmation_note ?? "").trim();
	const payment = "You can pay by PayPal, Venmo, CashApp, Zelle, cash or check.";
	const subject = "Your Baked by Erin order is confirmed!";
	const lines = [
		`Hi ${first},`,
		"",
		"Great news, your order is confirmed!",
		"",
		whenLine(order),
		"",
		...itemLines(order),
		...totalsLines(order),
		"",
		...(note ? [`A note from Erin: ${note}`, ""] : []),
		`Payment: ${payment}`,
		"",
		"If anything needs to change, just reply to this email.",
		"",
		"Thank you!",
		"Erin",
		"",
		`Order ref: ${id}`,
	];
	const html = htmlWrap(`
<p>Hi ${esc(first)},</p>
<p><strong>Great news, your order is confirmed!</strong></p>
<p style="margin:0 0 8px"><strong>${esc(whenLine(order))}</strong></p>
<ul style="padding-left:20px;margin:0 0 8px">${itemLines(order).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p style="margin:0 0 12px">${totalsLines(order).map(esc).join("<br>")}</p>
${note ? `<p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:10px 12px"><strong>A note from Erin:</strong> ${esc(note)}</p>` : ""}
<p><strong>Payment:</strong> ${esc(payment)}</p>
<p>If anything needs to change, just reply to this email.</p>
<p>Thank you!<br>Erin 🧁</p>
<p style="color:#6b7280;font-size:13px">Order ref: ${esc(id)}</p>`);
	return { to: String(order.customer_email), replyTo: ORDER_NOTIFY_EMAIL, subject, text: lines.join("\n"), html };
}
