import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { getEmDashCollection } from "emdash";
import { withEmDashRuntime } from "emdash/middleware";
import { buildEmail, isDue, taskKey } from "../../../lib/review-emails";

/**
 * POST /api/tasks/review-emails — called by the Worker's scheduled job (src/worker.ts),
 * not by people. Requires the x-task-key header derived from EMDASH_AUTH_SECRET.
 * Emails every order that is due (see src/lib/review-emails.ts) and marks it sent.
 */
export const POST: APIRoute = async ({ request }) => {
	const secret = (env as Record<string, unknown>).EMDASH_AUTH_SECRET;
	if (typeof secret !== "string" || !secret) return json({ ok: false, error: "not configured" }, 500);
	if (request.headers.get("x-task-key") !== (await taskKey(secret))) return json({ ok: false }, 404);

	const siteUrl = String((env as Record<string, unknown>).EMDASH_SITE_URL || new URL(request.url).origin);
	const { entries: orders } = await getEmDashCollection("orders", { status: "published", limit: 500 });
	const due = orders.filter((o) => isDue(o.data));

	const result = await withEmDashRuntime(async (runtime) => {
		const email = (runtime as any).email;
		if (!email?.isAvailable?.()) return { sent: 0, failed: 0, skipped: "email provider not set up (Settings → Email)" };
		let sent = 0;
		let failed = 0;
		for (const order of due) {
			const id = String((order.data as any).id ?? order.id);
			try {
				// Mark first, send second: if the order can't be marked (e.g. the review_email_sent
				// field hasn't been added in the admin yet), nothing is sent, so nobody gets repeats.
				const updated = await runtime.handleContentUpdate("orders", id, {
					data: { review_email_sent: new Date().toISOString() },
				});
				if ((updated as any)?.success === false) {
					console.error(`Review emails paused: could not mark order ${id} (${JSON.stringify((updated as any).error)}). Is the review_email_sent field added to Orders?`);
					return { sent, failed: failed + 1, skipped: "could not mark orders" };
				}
				await email.send(buildEmail(order.data, siteUrl), "system");
				sent++;
				console.log(`Review email sent for order ${id}`);
			} catch (err) {
				failed++;
				console.error(`Review email failed for order ${id}: ${(err as Error).message}`);
			}
		}
		return { sent, failed };
	});

	console.log(`Review emails: ${due.length} due, ${JSON.stringify(result)}`);
	return json({ ok: true, due: due.length, ...result }, 200);
};

function json(obj: unknown, status: number): Response {
	return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
