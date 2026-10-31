/**
 * A theme's palette from a few base colors. A theme that sets `--base-ground`
 * and `--base-ink` (and, if it likes, `--base-accent` and `--base-link`) gets
 * the rest of tokens.css's colors mixed from them, for light and dark mode at
 * once when a base is `light-dark(light, dark)`. A token the theme sets itself
 * wins over its derived one. Without bases, tokens.css's palette stands as tuned.
 */

type Rgb = [number, number, number];
type ModeColor = { light: Rgb; dark: Rgb };

export const BASES = ['--base-ground', '--base-ink', '--base-accent', '--base-link'] as const;

function hex(value: string): Rgb | undefined {
	const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
	if (!match) return undefined;
	const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
	return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

/** A base's value: one `#hex` for both modes, or `light-dark(#hex, #hex)`. */
export function readBase(value: string): ModeColor | undefined {
	const pair = /^light-dark\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/i.exec(value.trim());
	const light = hex(pair ? pair[1] : value);
	const dark = pair ? hex(pair[2]) : light;
	return light && dark ? { light, dark } : undefined;
}

const toHex = (c: Rgb) => `#${c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
/** `a` moved toward `b` by `t`. */
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((n, i) => n + (b[i] - n) * t) as Rgb;
const BLACK: Rgb = [0, 0, 0];

export function luminance(c: Rgb): number {
	const [r, g, b] = c.map((n) => {
		const v = n / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** The derived tokens for one mode, from that mode's bases. The steps follow tokens.css's own, dark and light. */
function palette(ground: Rgb, ink: Rgb, accent: Rgb | undefined, link: Rgb | undefined): Record<string, Rgb> {
	const dark = luminance(ground) < luminance(ink);
	const toward = (t: number) => mix(ground, ink, t);
	const tokens: Record<string, Rgb> = {
		'--bg-rail': dark ? mix(ground, BLACK, 0.45) : toward(0.12),
		'--bg-000': dark ? mix(ground, BLACK, 0.25) : toward(0.06),
		'--bg-100': ground,
		'--bg-200': toward(dark ? 0.06 : 0.035),
		'--bg-300': toward(dark ? 0.12 : 0.09),
		'--line': toward(dark ? 0.1 : 0.09),
		'--line-strong': toward(dark ? 0.5 : 0.55),
		'--ink': ink,
		'--ink-muted': mix(ink, ground, 0.3)
	};
	if (accent) {
		tokens['--accent'] = accent;
		// Text on the accent: the ground or the ink, whichever reads better on it.
		tokens['--on-accent'] = contrast(accent, ground) >= contrast(accent, ink) ? ground : ink;
		tokens['--accent-soft'] = mix(ground, accent, dark ? 0.18 : 0.16);
	}
	if (link) {
		tokens['--denim'] = link;
		tokens['--denim-soft'] = mix(ground, link, dark ? 0.2 : 0.14);
	}
	return tokens;
}

/** Why a theme's bases can't be read, if they can't. */
export function basesError(vars: ReadonlyMap<string, string>): string | undefined {
	const set = BASES.filter((name) => vars.has(name));
	if (!set.length) return undefined;
	for (const name of set) if (!readBase(vars.get(name)!)) return `${name} takes a #hex color, or light-dark(#hex, #hex).`;
	if (!vars.has('--base-ground') || !vars.has('--base-ink')) return 'Base colors start from --base-ground and --base-ink together.';
	return undefined;
}

/** The tokens derived from a theme's bases, before the theme's own; none without bases. Assumes `basesError` passed. */
export function deriveTokens(vars: ReadonlyMap<string, string>): Array<[string, string]> {
	if (!vars.has('--base-ground') || !vars.has('--base-ink')) return [];
	const base = (name: string) => (vars.has(name) ? readBase(vars.get(name)!) : undefined);
	const [ground, ink, accent, link] = BASES.map(base);
	const light = palette(ground!.light, ink!.light, accent?.light, link?.light);
	const dark = palette(ground!.dark, ink!.dark, accent?.dark, link?.dark);
	return Object.keys(light).map((name) => {
		const [l, d] = [toHex(light[name]), toHex(dark[name])];
		return [name, l === d ? l : `light-dark(${l}, ${d})`];
	});
}
