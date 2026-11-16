import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getEmDashCollection } from "emdash";
import { withEmDashRuntime } from "emdash/middleware";
import { buildEmail, isDue, taskKey } from "../../../lib/review-emails";
import { confirmationDue, confirmationEmail, itemCount, orderTitle } from "../../../lib/order-emails";

/**
 * POST /api/tasks/review-emails?jobs=confirm,review — called by the Worker's scheduled job
 * (src/worker.ts), not by people. Requires the x-task-key header derived from EMDASH_AUTH_SECRET.
 *
 *  confirm: order confirmation emails, for orders Erin set to "confirmed" (every 5 minutes)
 *  review:  review-request emails, 7 days after pickup (hourly, daytime)
 *
 * Each order is marked BEFORE its email is sent, so nobody ever gets the same email twice.
 * If marking fails (the field hasn't been added to Orders in the admin), that job stops.
 */
const JOBS = {
	confirm: { field: "confirmation_email_sent", due: (o: any) => confirmationDue(o), build: (o: any, id: string) => confirmationEmail(o, id) },
	review: { field: "review_email_sent", due: (o: any) => isDue(o), build: (o: any, _id: string, site: string) => buildEmail(o, site) },
} as const;

export const POST: APIRoute = async ({ request }) => {
	const e = env as Record<string, unknown>;
	const secret = e.EMDASH_AUTH_SECRET;
	if (typeof secret !== "string" || !secret) return json({ ok: false, error: "not configured" }, 500);
	if (request.headers.get("x-task-key") !== (await taskKey(secret))) return json({ ok: false }, 404);

	const url = new URL(request.url);
	const jobs = (url.searchParams.get("jobs") ?? "confirm,review").split(",").filter((j): j is keyof typeof JOBS => j in JOBS);
	const siteUrl = String(e.EMDASH_SITE_URL || url.origin);
	const { entries: orders } = await getEmDashCollection("orders", { status: "published", limit: 500 });

	const report = await withEmDashRuntime(async (runtime) => {
		// Housekeeping: give older orders a readable name and item count for the admin list.
		if (jobs.includes("confirm" as any)) {
			for (const order of orders.filter((o) => !(o.data as any).title || (o.data as any).item_count == null)) {
				const id = String((order.data as any).id ?? order.id);
				const r = await runtime.handleContentUpdate("orders", id, {
					data: { title: orderTitle(order.data), item_count: itemCount(order.data) },
				});
				if ((r as any)?.success === false) {
					console.error(`Order names paused: could not update ${id} (are the title and item_count fields added to Orders?)`);
					break;
				}
			}
		}
		const email = (runtime as any).email;
		if (!email?.isAvailable?.()) return { skipped: "email provider not set up (Settings → Email)" };
		const out: Record<string, unknown> = {};
		for (const job of jobs) {
			const { field, due, build } = JOBS[job];
			let sent = 0;
			let failed = 0;
			let stopped: string | undefined;
			for (const order of orders.filter((o) => due(o.data))) {
				const id = String((order.data as any).id ?? order.id);
				const updated = await runtime.handleContentUpdate("orders", id, { data: { [field]: new Date().toISOString() } });
				if ((updated as any)?.success === false) {
					stopped = `could not mark order ${id}: is the ${field} field added to Orders?`;
					console.error(`${job} emails paused: ${stopped} ${JSON.stringify((updated as any).error)}`);
					break;
				}
				try {
					await email.send(build(order.data, id, siteUrl), "system");
					sent++;
					console.log(`${job} email sent for order ${id}`);
				} catch (err) {
					failed++;
					console.error(`${job} email failed for order ${id}: ${(err as Error).message}`);
				}
			}
			out[job] = { sent, failed, ...(stopped ? { stopped } : {}) };
		}
		return out;
	});

	console.log(`Order email jobs: ${JSON.stringify(report)}`);
	return json({ ok: true, ...report }, 200);
};

function json(obj: unknown, status: number): Response {
	return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
