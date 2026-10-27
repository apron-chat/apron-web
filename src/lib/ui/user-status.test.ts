import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { byStatus, chosenStatusLabel, ownStatusLabel, pageSilenced, shownSeen, statusChoices, withLastSeen } from './user-status';

describe('statusChoices', () => {
	const offered = (accepted: string[], unsupported: string[], current: string | undefined) => statusChoices(accepted, unsupported, current).map((choice) => choice.value);

	it('offers Online and None, the optional ones server.status lists unless the server answered something else for one, and the current status', () => {
		const cases: Array<[string, string[], string[], string | undefined, string[]]> = [
			['every choice where server.status lists both optional ones', ['dnd', 'invisible'], [], 'online', ['online', 'dnd', 'invisible', '']],
			['only Online and None without server.status (or an empty one)', [], [], 'online', ['online', '']],
			['just the optional ones server.status lists, ignoring unknown ones', ['invisible', 'busy'], [], 'online', ['online', 'invisible', '']],
			['not one the server answered something else for', ['dnd', 'invisible'], ['invisible'], '', ['online', 'dnd', '']],
			['the current status, listed or not, so it shows as checked', [], [], 'dnd', ['online', 'dnd', '']],
			['the default, online, for an absent status', ['dnd'], [], undefined, ['online', 'dnd', '']],
			['nothing extra for an unknown current status', [], [], 'busy-coding', ['online', '']]
		];
		for (const [what, accepted, unsupported, current, expected] of cases) expect(offered(accepted, unsupported, current), what).toEqual(expected);
	});

	it('names and explains each choice', () => {
		expect(statusChoices(['dnd'], [], 'online').map((choice) => [choice.label, choice.hint])).toEqual([
			['Online', 'Automatic'], ['Do not disturb', 'Mutes notifications'], ['None', 'Show no status']
		]);
	});
});

describe('chosenStatusLabel', () => {
	it('names each choice, the default when absent, and an unknown one as itself', () => {
		expect(chosenStatusLabel('online')).toBe('Online');
		expect(chosenStatusLabel('')).toBe('None');
		expect(chosenStatusLabel(undefined)).toBe('None');
		expect(chosenStatusLabel('dnd')).toBe('Do not disturb');
		expect(chosenStatusLabel('brb')).toBe('brb');
	});
});

describe('ownStatusLabel', () => {
	it('says how others see you while invisible, and leaves the rest to the status\'s own words', () => {
		expect(ownStatusLabel('invisible')).toBe('Invisible · others see you as offline');
		expect(ownStatusLabel('dnd')).toBeUndefined();
		expect(ownStatusLabel(undefined)).toBeUndefined();
	});
});

describe('pageSilenced', () => {
	const now = 1_700_000_000_000;
	it('is quiet while paused, or while your status is dnd (§4.5: dnd silences as mute does)', () => {
		expect(pageSilenced(undefined, 'online', now)).toBe(false);
		expect(pageSilenced(true, 'online', now)).toBe(true);
		expect(pageSilenced(now + 1000, undefined, now)).toBe(true);
		expect(pageSilenced(now - 1000, 'online', now)).toBe(false);
		expect(pageSilenced(undefined, 'dnd', now)).toBe(true);
		// Invisible and no status don't silence.
		expect(pageSilenced(undefined, 'invisible', now)).toBe(false);
		expect(pageSilenced(undefined, '', now)).toBe(false);
	});
});

describe('byStatus', () => {
	it('orders online, idle, dnd, unknown, offline (and your invisible), then no status, keeping the order within each, in a new list', () => {
		const people: Array<[string, string | undefined]> = [
			['ann', undefined], ['bo', 'offline'], ['cy', 'idle'], ['di', 'online'], ['ed', 'dnd'], ['fy', 'online'], ['gu', 'invisible'], ['ha', 'idle'], ['io', 'brb'], ['jo', '']
		];
		const statuses = new Map(people);
		const ids = people.map(([id]) => id);
		expect(byStatus(ids, (id) => statuses.get(id))).toEqual(['di', 'fy', 'cy', 'ha', 'ed', 'io', 'bo', 'gu', 'ann', 'jo']);
		// A new list: the one given is left as it was.
		expect(ids).toEqual(people.map(([id]) => id));
	});
});

describe('shownSeen', () => {
	it('shows a kept seen only while the shown status is offline, and never yours', () => {
		expect(shownSeen({ status: 'offline', seen: '1724803600000' })).toBe('1724803600000');
		// Kept from before they came back (one-level merge, §4.5.2): not shown.
		for (const status of ['online', 'idle', 'dnd', '', 'brb', undefined]) expect(shownSeen({ status, seen: '1724803600000' }), String(status)).toBeUndefined();
		expect(shownSeen({ status: 'offline', seen: '1724803600000' }, true)).toBeUndefined();
		expect(shownSeen({ status: 'offline' })).toBeUndefined();
		expect(shownSeen(undefined)).toBeUndefined();
	});

	it('shows the later of the kept seen and when this client saw them go offline, only while offline, and never yours', () => {
		// A server that records seen coarsely gave an older one than this page saw: the floor shows.
		expect(shownSeen({ status: 'offline', seen: '1724803000000' }, false, 1724803600000)).toBe('1724803600000');
		// An older floor leaves a later seen (they came back and went again meanwhile).
		expect(shownSeen({ status: 'offline', seen: '1724803600000' }, false, 1724803000000)).toBe('1724803600000');
		expect(shownSeen({ status: 'offline', seen: '1724803600000' }, false, 1724803600000)).toBe('1724803600000');
		// Without a seen, or with one that can't be read, the floor alone.
		expect(shownSeen({ status: 'offline' }, false, 1724803600000)).toBe('1724803600000');
		expect(shownSeen({ status: 'offline', seen: 'yesterday' }, false, 1724803600000)).toBe('1724803600000');
		// Not while they show something else, and never for you.
		for (const status of ['online', 'idle', '', undefined]) expect(shownSeen({ status, seen: '1724803000000' }, false, 1724803600000), String(status)).toBeUndefined();
		expect(shownSeen({ status: 'offline', seen: '1724803000000' }, true, 1724803600000)).toBeUndefined();
		expect(shownSeen({ status: 'offline' }, true, 1724803600000)).toBeUndefined();
		// A floor no Date can hold is no floor.
		expect(shownSeen({ status: 'offline', seen: '1724803000000' }, false, 9_000_000_000_000_000)).toBe('1724803000000');
		expect(shownSeen({ status: 'offline' }, false, Number.NaN)).toBeUndefined();
	});

	it('takes only the log_id format, decimal digits of a positive integer below 2^53, up to the last date a Date holds', () => {
		expect(shownSeen({ status: 'offline', seen: '40' })).toBe('40');
		expect(shownSeen({ status: 'offline', seen: '8640000000000000' })).toBe('8640000000000000');
		// In the log_id format, but past what a Date holds: no time can be shown for it (formatting one throws).
		for (const seen of ['8640000000000001', '9000000000000000', '9007199254740991']) expect(shownSeen({ status: 'offline', seen }), seen).toBeUndefined();
		for (const seen of ['', '0', '-5', '1.5', '1e12', ' 1724803600000', '0x10', '01724803600000', 'yesterday', '9007199254740992', '99999999999999999999']) {
			expect(shownSeen({ status: 'offline', seen }), seen).toBeUndefined();
		}
		for (const seen of [1724803600000, null, true, {}, ['1']]) expect(shownSeen({ status: 'offline', seen }), JSON.stringify(seen)).toBeUndefined();
	});
});

/**
 * The day follows the browser's locale and time zone: here, a browser in
 * `en-US` in New York, set before the modules make their formats.
 */
describe('lastSeen', () => {
	let status: typeof import('./user-status');
	let time: typeof import('./time');
	beforeAll(async () => {
		vi.stubEnv('TZ', 'America/New_York');
		const Format = Intl.DateTimeFormat;
		vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
			return new Format(locale ?? 'en-US', options);
		} as typeof Intl.DateTimeFormat);
		// A fresh copy: another file in this worker may have made the formats already, in its own zone.
		vi.resetModules();
		[status, time] = await Promise.all([import('./user-status'), import('./time')]);
	});
	afterAll(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	// 2024-08-27 20:06:40 in New York.
	const now = 1724803600000;
	const at = (ms: number) => String(now - ms);
	const minute = 60_000, hour = 60 * minute, day = 24 * hour;
	const text = (seen: string) => status.lastSeen(seen, now)?.text;

	it('says recently under ten minutes ago, then how long ago, as the rest of the app does, then the day', () => {
		expect(text(at(0))).toBe('Last seen recently');
		expect(text(at(59_000))).toBe('Last seen recently');
		expect(text(at(4 * minute))).toBe('Last seen recently');
		expect(text(at(10 * minute - 1))).toBe('Last seen recently');
		expect(text(at(10 * minute))).toBe('Last seen 10m ago');
		expect(text(at(15 * minute))).toBe('Last seen 15m ago');
		expect(text(at(3 * hour))).toBe('Last seen 3h ago');
		expect(text(at(12 * day))).toBe('Last seen 12d ago');
		// Days up to two weeks, then the day.
		expect(text(at(13 * day))).toBe('Last seen 13d ago');
		expect(text(at(14 * day - 1))).toBe('Last seen 13d ago');
		expect(text(at(14 * day))).toBe('Last seen Aug 13');
		expect(text(at(40 * day))).toBe('Last seen Jul 18');
		expect(text(at(300 * day))).toBe('Last seen Nov 1, 2023');
	});

	it('says recently for a time a little ahead, from a clock that differs, and the day for one further ahead', () => {
		expect(text(at(-1 * minute))).toBe('Last seen recently');
		expect(text(at(-status.SEEN_SKEW_MS))).toBe('Last seen recently');
		// Not "recently" until this clock catches up, nor a time to come in "ago" words: the day the server said.
		expect(text(at(-status.SEEN_SKEW_MS - 1000))).toBe('Last seen Aug 27');
		expect(text(at(-3 * day))).toBe('Last seen Aug 30');
		expect(text(at(-200 * day))).toBe('Last seen Mar 15, 2025');
		const ahead = at(-3 * day);
		expect(status.lastSeen(ahead, now)).toEqual({ text: 'Last seen Aug 30', datetime: '2024-08-31T00:06:40.000Z', title: 'Last seen 2024-08-30 20:06:40' });
	});

	it('gives the datetime and the exact local time for the tooltip', () => {
		expect(status.lastSeen(at(3 * hour), now)).toEqual({ text: 'Last seen 3h ago', datetime: '2024-08-27T21:06:40.000Z', title: 'Last seen 2024-08-27 17:06:40' });
		expect(status.lastSeen(at(10 * minute), now)).toEqual({ text: 'Last seen 10m ago', datetime: '2024-08-27T23:56:40.000Z', title: 'Last seen 2024-08-27 19:56:40' });
	});

	it('gives no exact time in the tooltip while it says recently, which would say more than the words, but keeps the datetime', () => {
		expect(status.lastSeen(at(10 * minute - 1), now)).toEqual({ text: 'Last seen recently', datetime: '2024-08-27T23:56:40.001Z', title: 'Last seen within the last 10 minutes' });
		expect(status.lastSeen(at(0), now)).toEqual({ text: 'Last seen recently', datetime: '2024-08-28T00:06:40.000Z', title: 'Last seen within the last 10 minutes' });
		expect(status.lastSeen(at(-2 * minute), now)).toEqual({ text: 'Last seen recently', datetime: '2024-08-28T00:08:40.000Z', title: 'Last seen within the last 10 minutes' });
	});

	it('is nothing without a seen, or with one past the last date a Date holds', () => {
		expect(status.lastSeen(undefined, now)).toBeUndefined();
		expect(status.lastSeen('', now)).toBeUndefined();
		expect(status.lastSeen('soon', now)).toBeUndefined();
		for (const seen of ['8640000000000001', '9000000000000000', '9007199254740991']) expect(status.lastSeen(seen, now), seen).toBeUndefined();
		expect(time.idIso('9000000000000000')).toBeUndefined();
	});
});

describe('withLastSeen', () => {
	it('follows the status in words with when they were last seen, for a tooltip', () => {
		const last = { text: 'Last seen 15m ago', datetime: '', title: '' };
		expect(withLastSeen('Offline', last)).toBe('Offline · last seen 15m ago');
		expect(withLastSeen('Offline', { text: 'Last seen recently', datetime: '', title: '' })).toBe('Offline · last seen recently');
		expect(withLastSeen('Offline', undefined)).toBe('Offline');
		expect(withLastSeen(undefined, last)).toBeUndefined();
	});
});
