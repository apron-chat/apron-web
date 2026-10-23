/* Shared helpers for the presentational components. No protocol state: everything arrives as props. */
import type { Presence } from './types';

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

/**
 * What a room or thread is called wherever it is named (rows, cards, headers, breadcrumbs, menus, placeholders): its
 * `title`, else its `room_id` (§3.4: "absent: shown as room_id"). A title that is empty or only spaces counts as
 * absent, so nothing is ever named by a blank. The client's own titles follow the same rule (`roomTitle`).
 */
export function roomName(title: string | undefined | null, roomId: string | undefined): string {
	return typeof title === 'string' && title.trim() ? title : (roomId ?? '');
}

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
