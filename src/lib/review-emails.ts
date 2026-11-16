// Review-request emails: 7 days after an order's pickup/delivery date (any order that
// isn't cancelled), the customer gets a thank-you email with a link to /reviews.
// Sent through the email provider set up in the admin (Settings → Email → SMTP / Gmail).

/** Days after the pickup date before the email goes out. */
export const REVIEW_EMAIL_DELAY_DAYS = 7;
/** Orders older than this are skipped, so turning the feature on doesn't email old customers. */
export const REVIEW_EMAIL_MAX_AGE_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

/** Secret header value shared by the scheduled job and the task route (derived from EMDASH_AUTH_SECRET). */
export async function taskKey(authSecret: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`review-emails:${authSecret}`));
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isDue(order: Record<string, any>, now = Date.now()): boolean {
	if (order.order_status === "cancelled") return false;
	if (order.review_email_sent) return false;
	if (!order.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email)) return false;
	const pickup = Date.parse(String(order.pickup_date ?? ""));
	if (Number.isNaN(pickup)) return false;
	return pickup + REVIEW_EMAIL_DELAY_DAYS * DAY <= now && pickup >= now - REVIEW_EMAIL_MAX_AGE_DAYS * DAY;
}

function listItems(order: Record<string, any>): string {
	const names = [...new Set(((order.items as any[]) ?? []).map((i) => i?.product).filter(Boolean))] as string[];
	if (names.length === 0) return "your order";
	if (names.length === 1) return `the ${names[0]}`;
	return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The email itself. Edit the wording here. */
export function buildEmail(order: Record<string, any>, siteUrl: string) {
	const first = String(order.customer_name ?? "").trim().split(/\s+/)[0] || "there";
	const items = listItems(order);
	const link = `${siteUrl.replace(/\/$/, "")}/reviews`;
	const subject = "Thanks for ordering from Baked by Erin!";
	const text = [
		`Hi ${first},`,
		"",
		`Thank you for ordering ${items} from Baked by Erin! I hope you enjoyed every bite.`,
		"",
		`If you have a minute, I'd love to hear what you thought. You can leave a review here: ${link}`,
		"",
		"Thank you for supporting my small business!",
		"Erin",
	].join("\n");
	const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#2d2d2d;max-width:520px">
<p>Hi ${escapeHtml(first)},</p>
<p>Thank you for ordering ${escapeHtml(items)} from <strong>Baked by Erin</strong>! I hope you enjoyed every bite.</p>
<p>If you have a minute, I'd love to hear what you thought:</p>
<p><a href="${link}" style="display:inline-block;background:#8b4513;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:bold">Leave a review</a></p>
<p>Thank you for supporting my small business!<br>Erin 🧁</p>
</div>`;
	return { to: String(order.customer_email), subject, text, html };
}
