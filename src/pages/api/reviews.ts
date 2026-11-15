import type { APIRoute } from "astro";
import { withEmDashRuntime } from "emdash/middleware";

/**
 * POST /api/reviews — a customer submits a review.
 *
 * Reviews are saved as DRAFTS in the "reviews" collection. Nothing appears on the site
 * until Erin opens it in the admin (Reviews) and publishes it. Internet-facing: it
 * validates everything itself.
 */

const MIN_REVIEW_WORDS = 15; // keep in sync with src/pages/reviews.astro

export const POST: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: "Invalid request." }, 400);
	}
	const b = (body ?? {}) as Record<string, unknown>;
	const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

	// Hidden "website" field: people never see it, spam bots fill it in. Pretend it worked.
	if (str(b.website, 200)) return json({ ok: true }, 201);

	const reviewer_name = str(b.reviewer_name, 80);
	const items_ordered = str(b.items_ordered, 300);
	const review = typeof b.review === "string" ? b.review.trim().slice(0, 3000) : "";
	const words = review.split(/\s+/).filter(Boolean).length;

	if (!reviewer_name) return json({ ok: false, error: "Please add your name." }, 400);
	if (!items_ordered) return json({ ok: false, error: "Please tell us what you ordered." }, 400);
	if (words < MIN_REVIEW_WORDS)
		return json({ ok: false, error: `Reviews need at least ${MIN_REVIEW_WORDS} words (you have ${words}).` }, 400);
	if (/https?:\/\/|www\./i.test(review)) return json({ ok: false, error: "Please leave links out of your review." }, 400);

	try {
		await withEmDashRuntime(async (runtime) => {
			const created = await runtime.handleContentCreate("reviews", {
				data: { reviewer_name, items_ordered, review },
				slug: `review-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
				// Draft = waiting for Erin's approval. Publishing it in the admin puts it on /reviews.
				status: "draft",
			});
			if ((created as any).error) throw new Error(JSON.stringify((created as any).error));
		});
		console.log(`New review from ${reviewer_name} waiting for approval`);
		return json({ ok: true }, 201);
	} catch (err) {
		console.error(`Could not save review: ${(err as Error).message}`);
		return json({ ok: false, error: "Sorry, we couldn't save your review. Please try again later." }, 500);
	}
};

function json(obj: unknown, status: number): Response {
	return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
