import { describe, expect, it } from 'vitest';
import type { MembershipRecord } from '$lib/protocol/reducer';
import { isBaseline, listNames, membershipSummary, MembershipRun, netMemberships } from './membership';

let nextLog = 1000;
const record = (...entries: [string, boolean][]): MembershipRecord => ({
	log_id: String(nextLog++),
	entries: entries.map(([id, joined]) => ({ user: { user_id: id, name: id[0].toUpperCase() + id.slice(1) }, joined }))
});
const ids = (net: { joined: { user_id: string }[]; left: { user_id: string }[] }) => ({
	joined: net.joined.map((user) => user.user_id), left: net.left.map((user) => user.user_id)
});

describe('netting a run', () => {
	it('lists joins and leaves in the order each user first appears, none for no records', () => {
		expect(ids(netMemberships([record(['ada', true]), record(['carol', false]), record(['bob', true])]))).toEqual({ joined: ['ada', 'bob'], left: ['carol'] });
		expect(netMemberships([])).toEqual({ joined: [], left: [], added: [] });
	});

	it('drops a user who joins and leaves again, and one who leaves and comes back', () => {
		expect(ids(netMemberships([record(['ada', true]), record(['bob', false]), record(['ada', false]), record(['bob', true])]))).toEqual({ joined: [], left: [] });
		// Guest churn: join, leave, join again is still one join.
		expect(ids(netMemberships([record(['ada', true]), record(['ada', false]), record(['ada', true])]))).toEqual({ joined: ['ada'], left: [] });
	});

	it('nets the entries of one compacted record like separate records', () => {
		expect(ids(netMemberships([record(['ada', true], ['bob', true], ['carol', false])]))).toEqual({ joined: ['ada', 'bob'], left: ['carol'] });
	});

	it('shows each user as the latest recorded object in the run', () => {
		const renamed: MembershipRecord = { log_id: String(nextLog++), entries: [{ user: { user_id: 'ada', name: 'Ada L.' }, joined: false }] };
		const net = netMemberships([record(['ada', false]), { log_id: String(nextLog++), entries: [{ user: { user_id: 'ada', name: 'Ada' }, joined: true }] }, renamed]);
		expect(net.left).toEqual([{ user_id: 'ada', name: 'Ada L.' }]);
	});
});

describe('those you added', () => {
	it('lists a join you added apart, until a later entry for them in the run', () => {
		const run = new MembershipRun(record(['ada', true], ['bob', true]), new Set(['ada']));
		expect(run.net().added.map((user) => user.user_id)).toEqual(['ada']);
		expect(run.net().joined.map((user) => user.user_id)).toEqual(['bob']);
		run.add(record(['ada', false]));
		run.add(record(['ada', true]));
		expect(run.net().added).toEqual([]);
		expect(run.net().joined.map((user) => user.user_id)).toEqual(['ada', 'bob']);
	});
});

describe('baselines', () => {
	const joins = (count: number, leave = false) => record(...Array.from({ length: count }, (_, index): [string, boolean] => [`user${index}`, !(leave && index === 0)]));

	it('skips a record that joins more than 20 users at once, unless it also removes someone', () => {
		expect(isBaseline(joins(21))).toBe(true);
		expect(isBaseline(joins(20))).toBe(false);
		// One that also removes someone is a change, kept.
		expect(isBaseline(joins(30, true))).toBe(false);
	});
});

describe('wording', () => {
	it('joins up to three names with "and", then counts the rest', () => {
		expect(listNames(['Ada'])).toBe('Ada');
		expect(listNames(['Ada', 'Bob'])).toBe('Ada and Bob');
		expect(listNames(['Ada', 'Bob', 'Carol'])).toBe('Ada, Bob, and Carol');
		expect(listNames(['Ada', 'Bob', 'Carol', 'Dan'])).toBe('Ada, Bob, and 2 others');
		expect(listNames(['Ada', 'Bob', 'Carol', 'Dan', 'Eve', 'Fay'])).toBe('Ada, Bob, and 4 others');
	});

	it('says who joined, then who left, spelling out every name in the title when the line counts some', () => {
		expect(membershipSummary(['Ada'], [])).toEqual({ text: 'Ada joined' });
		expect(membershipSummary([], ['Bob'])).toEqual({ text: 'Bob left' });
		expect(membershipSummary(['Ada', 'Bob'], ['Carol'])).toEqual({ text: 'Ada and Bob joined · Carol left' });
		expect(membershipSummary([], []).text).toBe('');
		// Those you added come first, said as yours.
		expect(membershipSummary(['Ada'], ['Carol'], ['Dee'])).toEqual({ text: 'You added Dee · Ada joined · Carol left' });
		expect(membershipSummary([], [], ['Dee', 'Eve', 'Fay', 'Gus'])).toEqual({ text: 'You added Dee, Eve, and 2 others', title: 'You added: Dee, Eve, Fay, Gus' });
		// Every name is spelled out in the title, only when the line counts some.
		expect(membershipSummary(['Ada', 'Bob', 'Carol'], []).title).toBeUndefined();
		expect(membershipSummary(['Ada', 'Bob', 'Carol', 'Dan', 'Eve', 'Fay'], ['Gus'])).toEqual({
			text: 'Ada, Bob, and 4 others joined · Gus left',
			title: 'Joined: Ada, Bob, Carol, Dan, Eve, Fay\nLeft: Gus'
		});
	});
});
