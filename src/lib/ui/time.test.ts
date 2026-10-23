import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The formats follow the browser's locale and time zone: here, a browser in
 * `en-US` in New York (UTC-4 in September), set before the module makes them.
 */
let time: typeof import('./time');
beforeAll(async () => {
	vi.stubEnv('TZ', 'America/New_York');
	const Format = Intl.DateTimeFormat;
	vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
		return new Format(locale ?? 'en-US', options);
	} as typeof Intl.DateTimeFormat);
	// A fresh copy: another file in this worker may have made the formats already, in its own zone.
	vi.resetModules();
	time = await import('./time');
});
afterAll(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe('timestamps', () => {
	const id = String(Date.UTC(2026, 8, 14, 15, 4));

	it('follow the browser’s locale and time zone, with a compact form that drops AM/PM', () => {
		expect(time.idTime(id)).toBe('11:04 AM');
		expect(time.idTimeCompact(id)).toBe('11:04');
		expect(time.idDateTime(id)).toBe('2026-09-14 11:04:00');
		// Seconds too, and the day before in New York.
		expect(time.idDateTime(String(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('2026-01-01 22:04:05');
		expect(time.idIso(id)).toBe('2026-09-14T15:04:00.000Z');
	});

	it('say how long ago compactly: minutes, hours, days, weeks, then years', () => {
		const now = Date.UTC(2026, 8, 14, 15, 4);
		const ago = (ms: number) => time.idAgo(String(now - ms), now);
		const minute = 60_000, hour = 60 * minute, day = 24 * hour;
		expect(ago(20_000)).toBe('now');
		// A clock ahead of this one is still now.
		expect(time.idAgo(String(now + 5 * minute), now)).toBe('now');
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
		const since = (ms: number) => time.idSince(String(now - ms), now);
		expect(since(20_000)).toBe('now');
		expect(since(12 * minute)).toBe('12m');
		expect(since(9 * hour)).toBe('9h');
		expect(since(12 * day)).toBe('12d');
		expect(since(13 * day + 23 * hour)).toBe('13d');
		expect(since(14 * day)).toBe('Aug 31');
		expect(since(300 * day)).toBe('Nov 18, 2025');
		expect(time.idSince('opaque', now)).toBe('');
	});

	it('are empty for IDs that carry no time', () => {
		expect(time.idTime('opaque')).toBe('');
		expect(time.idTimeCompact('opaque')).toBe('');
		expect(time.idAgo('opaque')).toBe('');
		expect(time.idIso('opaque')).toBeUndefined();
	});
});
