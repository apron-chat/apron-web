import { describe, expect, it } from 'vitest';
import { byStatus, chosenStatusLabel, lastSeen, ownStatusLabel, pageSilenced, shownSeen, statusChoices, withLastSeen } from './user-status';
import { idDateTime, idSince } from './time';

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

	it('takes only the log_id format: decimal digits of a positive integer below 2^53', () => {
		expect(shownSeen({ status: 'offline', seen: '40' })).toBe('40');
		expect(shownSeen({ status: 'offline', seen: '9007199254740991' })).toBe('9007199254740991');
		for (const seen of ['', '0', '-5', '1.5', '1e12', ' 1724803600000', '0x10', '01724803600000', 'yesterday', '9007199254740992', '99999999999999999999']) {
			expect(shownSeen({ status: 'offline', seen }), seen).toBeUndefined();
		}
		for (const seen of [1724803600000, null, true, {}, ['1']]) expect(shownSeen({ status: 'offline', seen }), JSON.stringify(seen)).toBeUndefined();
	});
});

describe('lastSeen', () => {
	const now = 1724803600000;
	const at = (ms: number) => String(now - ms);
	const minute = 60_000, hour = 60 * minute, day = 24 * hour;

	it('says how long ago, as the rest of the app does, then the day', () => {
		const text = (seen: string) => lastSeen(seen, now)?.text;
		expect(text(at(0))).toBe('Last seen just now');
		expect(text(at(59_000))).toBe('Last seen just now');
		// A clock ahead of ours: just now, not a time to come.
		expect(text(at(-5 * minute))).toBe('Last seen just now');
		expect(text(at(5 * minute))).toBe('Last seen 5m ago');
		expect(text(at(3 * hour))).toBe('Last seen 3h ago');
		expect(text(at(12 * day))).toBe('Last seen 12d ago');
		expect(text(at(40 * day))).toBe(`Last seen ${idSince(at(40 * day), now)}`);
		expect(text(at(40 * day))).not.toMatch(/ago$/);
	});

	it('gives the datetime and the exact time for the tooltip', () => {
		const seen = at(3 * hour);
		expect(lastSeen(seen, now)).toEqual({ text: 'Last seen 3h ago', datetime: new Date(now - 3 * hour).toISOString(), title: `Last seen ${idDateTime(seen)}` });
	});

	it('is nothing without a seen', () => {
		expect(lastSeen(undefined, now)).toBeUndefined();
		expect(lastSeen('', now)).toBeUndefined();
		expect(lastSeen('soon', now)).toBeUndefined();
	});
});

describe('withLastSeen', () => {
	it('follows the status in words with when they were last seen, for a tooltip', () => {
		const last = { text: 'Last seen 5m ago', datetime: '', title: '' };
		expect(withLastSeen('Offline', last)).toBe('Offline · last seen 5m ago');
		expect(withLastSeen('Offline', undefined)).toBe('Offline');
		expect(withLastSeen(undefined, last)).toBeUndefined();
	});
});
