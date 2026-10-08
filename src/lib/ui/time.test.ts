import { describe, expect, it } from 'vitest';
import { idAgo, idDateTime, idIso, idTime, idTimeCompact } from './time';

describe('timestamps', () => {
	const id = String(Date.UTC(2026, 8, 14, 15, 4));

	it('follow the browser locale, with a compact form that drops AM/PM', () => {
		const expected = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(Number(id));
		expect(idTime(id)).toBe(expected);
		expect(idTimeCompact(id)).not.toMatch(/[AP]\.?M\.?/i);
		expect(idTimeCompact(id)).toMatch(/\d{1,2}.\d{2}/);
		const local = new Date(Number(id));
		const pad = (value: number) => String(value).padStart(2, '0');
		expect(idDateTime(id)).toBe(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}:00`);
		expect(idDateTime(String(Date.UTC(2026, 0, 2, 3, 4, 5)))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:05$/);
		expect(idIso(id)).toBe('2026-09-14T15:04:00.000Z');
	});

	it('say how long ago compactly: minutes, hours, the weekday, the day, then the year', () => {
		const now = Date.UTC(2026, 8, 14, 15, 4);
		const ago = (ms: number) => idAgo(String(now - ms), now);
		const minute = 60_000, hour = 60 * minute, day = 24 * hour;
		expect(ago(20_000)).toBe('now');
		// A clock ahead of this one is still now.
		expect(idAgo(String(now + 5 * minute), now)).toBe('now');
		expect(ago(5 * minute)).toBe('5m');
		expect(ago(59 * minute)).toBe('59m');
		expect(ago(3 * hour)).toBe('3h');
		expect(ago(2 * day)).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(now - 2 * day));
		expect(ago(40 * day)).toBe(new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(now - 40 * day));
		expect(ago(400 * day)).toBe(new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(now - 400 * day));
	});

	it('are empty for IDs that carry no time', () => {
		expect(idTime('opaque')).toBe('');
		expect(idTimeCompact('opaque')).toBe('');
		expect(idAgo('opaque')).toBe('');
		expect(idIso('opaque')).toBeUndefined();
	});
});
