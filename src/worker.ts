import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { taskKey } from "./lib/review-emails";

export { PluginBridge };

const emdashScheduled = createScheduledHandler();

export default {
	...handler,
	async scheduled(controller, env, ctx) {
		// EmDash's own jobs (scheduled publishing, maintenance) — every minute.
		await emdashScheduled(controller, env, ctx);

		// Review-request emails: hourly, 9am–6pm Miami time (14:00–23:00 UTC in winter).
		const t = new Date(controller.scheduledTime);
		const hour = t.getUTCHours();
		if (t.getUTCMinutes() === 0 && hour >= 14 && hour <= 23) {
			const e = env as unknown as Record<string, string>;
			if (!e.EMDASH_AUTH_SECRET || !handler.fetch) return;
			const site = (e.EMDASH_SITE_URL || "https://bakedbyerin.com").replace(/\/$/, "");
			const req = new Request(`${site}/api/tasks/review-emails`, {
				method: "POST",
				headers: { "x-task-key": await taskKey(e.EMDASH_AUTH_SECRET) },
			});
			ctx.waitUntil(
				Promise.resolve(handler.fetch(req as any, env as any, ctx))
					.then(async (res) => console.log(`review-emails task: ${res.status} ${await res.text()}`))
					.catch((err) => console.error(`review-emails task failed: ${err}`)),
			);
		}
	},
} satisfies ExportedHandler;
