// Which product categories live on the Holiday page instead of the main Menu page.
// Each entry is a section on /holiday, shown in this order. The slug must match the
// category's slug in the admin (Categories); the title is what customers see.
export const HOLIDAY_SECTIONS = [
	{ slug: "holiday", title: "Holiday Bundle" },
	{ slug: "passover", title: "Passover" },
	{ slug: "seasonal", title: "Summer Refresh" },
];

const HOLIDAY_SLUGS = new Set(HOLIDAY_SECTIONS.map((s) => s.slug));

/**
 * Most specific section first. Items can carry several categories (e.g. "holiday" AND
 * "passover"); each item is shown in the first of these it has, so the general "holiday"
 * tag only puts an item under Holiday Bundle when it isn't Passover or Summer Refresh.
 */
const SECTION_PRIORITY = ["passover", "seasonal", "holiday"];

/** The Holiday-page section an item belongs to, or null if it's a regular menu item. */
export function holidaySectionOf(product: { data: { terms?: { category?: { slug: string }[] } } }): string | null {
	const slugs = new Set((product.data.terms?.category ?? []).map((t) => t.slug));
	return SECTION_PRIORITY.find((s) => slugs.has(s)) ?? null;
}

/** True for category slugs that belong on the Holiday page. */
export function isHolidayCategory(slug: string | null | undefined): boolean {
	return !!slug && HOLIDAY_SLUGS.has(slug);
}

/** True when any of the product's categories belongs on the Holiday page. */
export function isHolidayProduct(product: { data: { terms?: { category?: { slug: string }[] } } }): boolean {
	return (product.data.terms?.category ?? []).some((t) => isHolidayCategory(t.slug));
}
