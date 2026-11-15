// Which product categories live on the Holiday page instead of the main Menu page.
// Each entry is a section on /holiday, shown in this order. The slug must match the
// category's slug in the admin (Categories); the title is what customers see.
export const HOLIDAY_SECTIONS = [
	{ slug: "holiday", title: "Holiday Bundle" },
	{ slug: "passover", title: "Passover" },
	{ slug: "seasonal", title: "Summer Refresh" },
];

const HOLIDAY_SLUGS = new Set(HOLIDAY_SECTIONS.map((s) => s.slug));

/** True for category slugs that belong on the Holiday page. */
export function isHolidayCategory(slug: string | null | undefined): boolean {
	return !!slug && HOLIDAY_SLUGS.has(slug);
}

/** True when any of the product's categories belongs on the Holiday page. */
export function isHolidayProduct(product: { data: { terms?: { category?: { slug: string }[] } } }): boolean {
	return (product.data.terms?.category ?? []).some((t) => isHolidayCategory(t.slug));
}
