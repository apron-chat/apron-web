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

	it('say how long ago compactly: minutes, hours, days, weeks, then years', () => {
		const now = Date.UTC(2026, 8, 14, 15, 4);
		const ago = (ms: number) => idAgo(String(now - ms), now);
		const minute = 60_000, hour = 60 * minute, day = 24 * hour;
		expect(ago(20_000)).toBe('now');
		// A clock ahead of this one is still now.
		expect(idAgo(String(now + 5 * minute), now)).toBe('now');
		expect(ago(5 * minute)).toBe('5m');
		expect(ago(59 * minute)).toBe('59m');
		expect(ago(3 * hour)).toBe('3h');
		expect(ago(23 * hour + 59 * minute)).toBe('23h');
		expect(ago(day)).toBe('1d');
		expect(ago(6 * day)).toBe('6d');
		expect(ago(7 * day)).toBe('1w');
		expect(ago(63 * day)).toBe('9w');
		expect(ago(51 * 7 * day + 6 * day)).toBe('51w');
		expect(ago(52 * 7 * day)).toBe('1y');
		expect(ago(400 * day)).toBe('1y');
		expect(ago(800 * day)).toBe('2y');
	});

	it('are empty for IDs that carry no time', () => {
		expect(idTime('opaque')).toBe('');
		expect(idTimeCompact('opaque')).toBe('');
		expect(idAgo('opaque')).toBe('');
		expect(idIso('opaque')).toBeUndefined();
	});
});
