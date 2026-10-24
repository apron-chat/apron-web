import { describe, expect, it } from 'vitest';
import { byStatus, chosenStatusLabel, ownStatusLabel, pageSilenced, statusChoices } from './user-status';

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
