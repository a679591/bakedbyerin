// Shared menu rules used by the product cards, the cart page and the order API.
// The cart page has a small browser-side copy of checkMinimums — keep the two in sync.

/**
 * The product's "Mix-in choices" field.
 *   "Chocolate Chips, Oreos"      → the customer must pick one
 *   "optional: Chocolate Chips"   → a free add-on the customer can skip
 */
export function parseMixins(raw: unknown): { choices: string[]; optional: boolean } {
	if (typeof raw !== "string" || !raw.trim()) return { choices: [], optional: false };
	const optional = /^\s*optional\s*:/i.test(raw);
	const list = raw.replace(/^\s*optional\s*:/i, "");
	return { choices: list.split(",").map((s) => s.trim()).filter(Boolean), optional };
}

export interface CartLine {
	category: string | null;
	size: string;
	quantity: number;
}

/**
 * Minimum-quantity groups. A group's minimum applies only when the whole cart
 * is made of that group — add anything else and the minimum no longer applies.
 */
export const MIN_GROUPS = [
	{ key: "mini", min: 2, label: "mini (small) breads", match: (l: CartLine) => l.size === "Small" },
	{ key: "granola", min: 2, label: "bags of granola", match: (l: CartLine) => l.category === "granola" },
];

/** Returns an error message, or null when the cart is fine. */
export function checkMinimums(lines: CartLine[]): string | null {
	if (lines.length === 0) return null;
	const keys = lines.map((l) => MIN_GROUPS.find((g) => g.match(l))?.key ?? null);
	const first = keys[0];
	if (!first || keys.some((k) => k !== first)) return null;
	const group = MIN_GROUPS.find((g) => g.key === first)!;
	const total = lines.reduce((n, l) => n + l.quantity, 0);
	if (total >= group.min) return null;
	return `There's a minimum of ${group.min} ${group.label} per order, unless you add something else to your cart.`;
}
