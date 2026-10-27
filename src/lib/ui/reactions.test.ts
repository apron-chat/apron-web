import { describe, expect, it } from 'vitest';
import type { ReactionSummary } from '$lib/protocol/client';
import { reactionChips, reactorsOf, whoReacted } from './reactions';

/** The words as read, without the isolates around each name. */
const read = (text: string) => text.replace(/[\u2068\u2069]/g, '');

const summary = (emoji: string, users: string[], mine = false): ReactionSummary => ({
	emoji,
	count: users.length,
	user_ids: [...users].sort(),
	users: [...users].sort().map((user_id) => ({ user_id, name: user_id[0].toUpperCase() + user_id.slice(1) })),
	mine
});

describe('reaction chips', () => {
	it('shows one chip per emoji with its count and whether you reacted, and none on tombstones or messages nobody reacted to', () => {
		const chips = reactionChips([summary('👍', ['ada', 'bob', 'you'], true), summary('🎉', ['bob'])], 'you');
		expect(chips.map(({ emoji, count, mine }) => [emoji, count, mine])).toEqual([['👍', 3, true], ['🎉', 1, false]]);
		expect(read(chips[0].title)).toBe('You, Ada and Bob reacted with 👍');
		expect(chips[0].label).toBe('👍 3 reactions, including yours. Remove yours');
		expect(read(chips[1].title)).toBe('Bob reacted with 🎉');
		expect(chips[1].label).toBe('🎉 1 reaction. Add yours');
		// None on tombstones, or for messages nobody reacted to.
		expect(reactionChips([summary('👍', ['ada'])], 'you', true)).toEqual([]);
		expect(reactionChips(undefined, 'you')).toEqual([]);
		expect(reactionChips([summary('👍', [])], 'you')).toEqual([]);
	});

	it('names who reacted, you first, summing up a long list, and lists them all', () => {
		expect(read(whoReacted(summary('👍', ['you'], true), 'you'))).toBe('You');
		expect(read(whoReacted(summary('👍', ['ada', 'bob']), 'you'))).toBe('Ada and Bob');
		const crowd = summary('👍', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'you'], true);
		expect(read(whoReacted(crowd, 'you'))).toBe('You, A1, A2, A3, A4, A5, A6 and 3 others');
		const unnamed: ReactionSummary = { emoji: '👀', count: 1, user_ids: ['guest_1'], users: [{ user_id: 'guest_1' }], mine: false };
		expect(read(whoReacted(unnamed, undefined))).toBe('guest_1');
		// Callers render reactors through the kept user objects (§3.3).
		expect(read(whoReacted(summary('👍', ['ada', 'bob']), 'you', (user) => `${user.user_id}!`))).toBe('ada! and bob!');
		expect(reactionChips([summary('👍', ['ada'])], 'you', false, () => 'Kept')[0].title).toBe('\u2068Kept\u2069 reacted with 👍');
		// And lists them all, you first.
		expect(reactionChips([summary('👍', ['ada', 'bob', 'you'], true)], 'you')[0].reactors.map((user) => user.user_id)).toEqual(['you', 'ada', 'bob']);
		expect(reactorsOf(summary('👍', ['bob', 'ada']), 'you').map((user) => user.name)).toEqual(['Ada', 'Bob']);
		// Your own set counts before its echo names you.
		expect(reactorsOf({ ...summary('👍', ['ada']), mine: true }, 'you')).toEqual([{ user_id: 'you' }, { user_id: 'ada', name: 'Ada' }]);
		expect(reactorsOf(summary('👍', ['ada']), undefined).map((user) => user.user_id)).toEqual(['ada']);
	});
});
