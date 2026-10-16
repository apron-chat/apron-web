import { describe, expect, it } from 'vitest';
import { idAgo, idDateTime, idIso, idSince, idTime, idTimeCompact } from './time';

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

	it('say when a last reply was: relative within two weeks, then the day', () => {
		const now = Date.UTC(2026, 8, 14, 15, 4);
		const minute = 60_000, hour = 60 * minute, day = 24 * hour;
		const since = (ms: number) => idSince(String(now - ms), now);
		const date = (options: Intl.DateTimeFormatOptions, ms: number) => new Intl.DateTimeFormat(undefined, options).format(now - ms);
		expect(since(20_000)).toBe('now');
		expect(since(12 * minute)).toBe('12m');
		expect(since(9 * hour)).toBe('9h');
		expect(since(12 * day)).toBe('12d');
		expect(since(13 * day + 23 * hour)).toBe('13d');
		expect(since(14 * day)).toBe(date({ day: 'numeric', month: 'short' }, 14 * day));
		expect(since(300 * day)).toBe(date({ day: 'numeric', month: 'short', year: 'numeric' }, 300 * day));
		expect(idSince('opaque', now)).toBe('');
	});

	it('are empty for IDs that carry no time', () => {
		expect(idTime('opaque')).toBe('');
		expect(idTimeCompact('opaque')).toBe('');
		expect(idAgo('opaque')).toBe('');
		expect(idIso('opaque')).toBeUndefined();
	});
});
