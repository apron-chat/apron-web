/* Shared helpers for the presentational components. No protocol state: everything arrives as props. */
import type { EmbedAttributes, EmbedComponentProps, EmbedProps, Presence } from './types';

/** A user object (§3.3). `user_id` is stable; `name` falls back to it; `avatar` is optional (§4.8.6). */
export interface Sender {
	user_id: string;
	name?: string;
	avatar?: string;
	/** Server-assigned labels such as "admin" or "bot" (§3.3), shown as badges beside the name. */
	roles?: string[];
	ext?: Record<string, unknown>;
}

export function uid(u: { user_id?: string } | undefined | null): string | undefined {
	return u?.user_id || undefined;
}

// What rooms and threads are called: one rule with the client's titles, kept outside the design system.
export { roomName, roomNameTip, titled, UNTITLED } from '../../naming';

/** How far each role stacked behind a badge peeks out past the one in front of it, in px, its 1px edge included (`.ap-role-stacked`). */
export const ROLE_PEEK = 4;
/** Stacked roles drawn behind a badge: past this many, the stack shows no deeper. */
export const ROLE_STACK_MAX = 3;

/** The width the stack behind a badge adds, for `hidden` roles behind it: each layer, the badge's own size, peeks out by ROLE_PEEK. */
export function rolePeek(hidden: number): number {
	const layers = Math.min(Math.max(hidden, 0), ROLE_STACK_MAX);
	return layers * ROLE_PEEK;
}

/**
 * How many of a row of role badges show, when they are stacked rather than dropped: as many whole badges as fit, the
 * last of them carrying the rest as a stack behind it (`rolePeek`). Where not even the first whole badge and its stack
 * fit, the first narrows to `room` (ellipsized), but never under `min`; below that none show. `widths` are the badges'
 * own widths in order, `gap` the space between them, `available` the row's.
 */
export function fitRoles(widths: number[], available: number, gap: number, min: number): { shown: number; room?: number } {
	const n = widths.length;
	if (!n) return { shown: 0 };
	let used = 0;
	const ends: number[] = [];
	for (const w of widths) ends.push((used += (ends.length ? gap : 0) + w));
	if (ends[n - 1] <= available) return { shown: n };
	for (let k = n - 1; k >= 1; k--) if (ends[k - 1] + rolePeek(n - k) <= available) return { shown: k };
	const room = Math.floor(available - rolePeek(n - 1));
	return room >= min ? { shown: 1, room } : { shown: 0 };
}

/**
 * A computed CSS length in px, as `getComputedStyle` reports a min-width: a plain length (`96px`), or the math a
 * browser leaves unresolved there, `calc()`, `min()`, `max()`, `clamp()` and `calc-size(<basis>, …)`, over px, em,
 * percentages and calc-size's `size`. `size` is the box's natural width (its basis), `percent` what 100% is, `em` its
 * font size. Anything else (`auto`, an intrinsic keyword outside calc-size) is undefined: the caller decides.
 */
export function cssPx(value: string, context: { size?: number; percent?: number; em?: number }): number | undefined {
	const tokens = value.trim().match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px|em|%)?|[a-z-]+\(|[a-z-]+|[(),+*/-]/gi);
	if (!tokens || tokens.join('').replace(/\s/g, '') !== value.replace(/\s/g, '')) return undefined;
	let at = 0;
	const fail = (): never => { throw new Error('unresolved'); };
	const peek = () => tokens[at];
	const take = (expected?: string) => (expected === undefined || tokens[at] === expected ? tokens[at++] : fail());
	function args(): number[] {
		const list = [sum()];
		while (peek() === ',') { take(); list.push(sum()); }
		take(')');
		return list;
	}
	function atom(): number {
		const token = take() ?? fail();
		if (token === '(') { const inner = sum(); take(')'); return inner; }
		if (token === '-') return -atom();
		if (token === 'size') return context.size ?? fail();
		const fn = token.toLowerCase();
		if (fn === 'calc(') { const inner = sum(); take(')'); return inner; }
		if (fn === 'min(') return Math.min(...args());
		if (fn === 'max(') return Math.max(...args());
		if (fn === 'clamp(') { const [lo, mid, hi] = args(); return Math.max(lo, Math.min(mid, hi)); }
		if (fn === 'calc-size(') {
			const basis = take();
			if (!/^(max-content|min-content|fit-content|auto|any)$/.test(basis)) fail();
			take(',');
			const inner = sum();
			take(')');
			return inner;
		}
		const number = token.match(/^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|em|%)?$/i) ?? fail();
		const n = parseFloat(number[1]);
		const unit = (number[2] ?? '').toLowerCase();
		if (unit === 'em') return n * (context.em ?? fail());
		if (unit === '%') return (n / 100) * (context.percent ?? fail());
		// px, or a plain number (a factor, or 0).
		return n;
	}
	function product(): number {
		let left = atom();
		while (peek() === '*' || peek() === '/') left = take() === '*' ? left * atom() : left / atom();
		return left;
	}
	function sum(): number {
		let left = product();
		while (peek() === '+' || peek() === '-') left = take() === '+' ? left + product() : left - product();
		return left;
	}
	try {
		const result = sum();
		return at === tokens.length && Number.isFinite(result) ? result : undefined;
	} catch {
		return undefined;
	}
}

/**
 * One handler from a component's own and a caller's, for an event both listen to (the caller's extra attributes win,
 * so handlers chain rather than replace). The caller's runs first; if it calls `preventDefault()`, the component's own
 * is skipped, which is how a caller replaces a built-in behavior. Either may be absent.
 */
export function chain<E extends Event>(own: ((event: E) => void) | null | undefined, caller: ((event: E) => void) | null | undefined): ((event: E) => void) | undefined {
	if (!own) return caller ?? undefined;
	if (!caller) return own;
	return (event: E) => {
		caller(event);
		if (!event.defaultPrevented) own(event);
	};
}

export function initials(name: string | undefined): string {
	const p = String(name || '?').trim().split(/\s+/);
	return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

export interface Times {
	short?: string;
	compact?: string;
	exact?: string;
	iso?: string;
}

/** Times from a message_id (epoch ms): short in the viewer's locale and 12/24h preference, compact without AM/PM for the grouped hover gutter, and exact local YYYY-MM-DD HH:MM:SS for the tooltip. */
export function times(timestamp?: number, time?: string): Times {
	const ms = Number(timestamp);
	if (!(ms > 0)) return { short: time, compact: time };
	const d = new Date(ms);
	return {
		short: time || TIME.format(d),
		compact: TIME.formatToParts(d)
			.filter((p) => p.type !== 'dayPeriod')
			.map((p) => p.value)
			.join('')
			.trim(),
		exact: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
		iso: d.toISOString()
	};
}

/** Only https/http, small inline images, local blob: previews and in-page anchors are rendered. */
export function safeHttp(u: unknown): string | undefined {
	return typeof u === 'string' && /^(https?:|data:image\/(png|jpeg|gif|webp);base64,|blob:|#)/i.test(u) ? u : undefined;
}

/** Every field of EmbedProps, so an Embed component can tell the embed's own from the attributes for its root. */
const EMBED_FIELDS: Record<keyof EmbedProps, true> = {
	embed_id: true, kind: true, url: true, title: true, og: true, progress: true, failed: true, detail: true, onview: true, link: true,
	format: true, text: true, done: true, truncated: true, status: true, children: true, attach: true, height: true, live: true, onactivate: true, html: true
};

/** An Embed component's props less the embed's fields: the attributes (`data-testid`, `class`, …) that go on its root. */
export function embedAttributes(props: Partial<EmbedComponentProps>): EmbedAttributes {
	const attributes: Record<string, unknown> = {};
	for (const key of Object.keys(props)) if (!(key in EMBED_FIELDS)) attributes[key] = props[key as keyof EmbedComponentProps];
	return attributes as EmbedAttributes;
}

export function ogRatio(m?: { width?: number; height?: number }): string | undefined {
	return m && m.width && m.height ? `aspect-ratio: ${m.width} / ${m.height}` : undefined;
}

export const count99 = (n: number) => (n > 99 ? '99+' : String(n));

/**
 * A `status` (§4.5) as a StatusDot draws it: absent or empty (none, §3.3)
 * shows nothing, and a value this client doesn't know is `unknown`.
 */
export function presence(status: string | undefined): Presence | undefined {
	if (status === undefined || status === '') return undefined;
	return KNOWN.has(status) ? (status as Presence) : 'unknown';
}

const KNOWN = new Set<string>(['online', 'idle', 'dnd', 'offline', 'invisible']);

/** A `status` in words: its label, or for an unknown one with the value itself (“Unknown status: brb”). Undefined when there is none. */
export function presenceLabel(status: string | undefined): string | undefined {
	const shown = presence(status);
	if (!shown) return undefined;
	return shown === 'unknown' ? `${PRESENCE_LABELS.unknown}: ${String(status).slice(0, 64)}` : PRESENCE_LABELS[shown];
}

/** A status in words, for tooltips and screen readers. */
export const PRESENCE_LABELS: Record<Presence, string> = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline', invisible: 'Invisible', unknown: 'Unknown status' };

/**
 * A click a component may take over, such as opening an image in the viewer:
 * the main button with no modifier. Cmd, Ctrl, Shift and Alt clicks (and the
 * middle button, which fires `auxclick`) keep a link's own behavior: a new tab,
 * a new window, a download.
 */
export function plainClick(event: MouseEvent): boolean {
	return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}
