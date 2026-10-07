import { describe, expect, it } from 'vitest';
import { byStatus, chosenStatusLabel, ownStatusLabel, pageSilenced, STATUS_CHOICES } from './user-status';

describe('STATUS_CHOICES', () => {
	it('offers online, dnd, invisible and none (§4.5), with no durations', () => {
		expect(STATUS_CHOICES.map((choice) => choice.value)).toEqual(['online', 'dnd', 'invisible', '']);
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
	it('orders online, idle, dnd, unknown, offline (and your invisible), then no status, keeping the order within each', () => {
		const people: Array<[string, string | undefined]> = [
			['ann', undefined], ['bo', 'offline'], ['cy', 'idle'], ['di', 'online'], ['ed', 'dnd'], ['fy', 'online'], ['gu', 'invisible'], ['ha', 'idle'], ['io', 'brb'], ['jo', '']
		];
		const statuses = new Map(people);
		expect(byStatus(people.map(([id]) => id), (id) => statuses.get(id))).toEqual(['di', 'fy', 'cy', 'ha', 'ed', 'io', 'bo', 'gu', 'ann', 'jo']);
	});
	it('leaves the input alone', () => {
		const ids = ['b', 'a'];
		byStatus(ids, (id) => (id === 'a' ? 'online' : undefined));
		expect(ids).toEqual(['b', 'a']);
	});
});
