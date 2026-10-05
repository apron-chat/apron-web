/* Shared helpers for the presentational components. No protocol state: everything arrives as props. */

/** A user object (§3.3). `user_id` is stable; `name` falls back to it; `avatar` is optional (§4.6.6). */
export interface Sender {
	user_id: string;
	name?: string;
	avatar?: string;
	/** Server-assigned labels such as "admin" or "bot" (§3.3), shown as badges beside the name. */
	roles?: string[];
	ext?: Record<string, unknown>;
	/** @deprecated alias of user_id */
	id?: string;
}

export function uid(u: { user_id?: string; id?: string } | undefined | null): string | undefined {
	return u ? u.user_id || u.id : undefined;
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

export function fmtSize(n?: number): string {
	if (n == null) return '';
	const u = ['B', 'KB', 'MB', 'GB'];
	let i = 0;
	while (n >= 1024 && i < u.length - 1) {
		n /= 1024;
		i++;
	}
	return (i ? n.toFixed(1) : n) + ' ' + u[i];
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
 * A `status` (§4.11) as one of the four: absent or empty (cleared, §3.3)
 * shows none, and any other unknown value counts as `offline`.
 */
export function presence(status: string | undefined): 'online' | 'idle' | 'dnd' | 'offline' | undefined {
	if (status === undefined || status === '') return undefined;
	return status === 'online' || status === 'idle' || status === 'dnd' ? status : 'offline';
}

/** A status in words, for tooltips and screen readers. */
export const PRESENCE_LABELS = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' } as const;
