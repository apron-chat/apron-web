import { describe, expect, it } from 'vitest';
import { collapseMentions, draftLength, draftMentions, draftText, insertMention, insertText, mentionQuery, unchip, type DraftChip, type DraftPart } from './draft';

const people = [
	{ id: 'ada_1', name: 'Ada' },
	{ id: 'lovelace', name: 'Ada Lovelace' },
	{ id: 'bob', name: 'Bob' },
	{ id: 'sam_a', name: 'Sam' },
	{ id: 'sam_b', name: 'sam' }
];

function typed(text: string, caret = text.length, final = false) {
	return collapseMentions([text], people, { caret, final });
}

describe('composer mentions', () => {
	it('chips a finished @user_id or @name and sends @user_id, keeping existing chips and moving the caret across new ones', () => {
		expect(typed('hi @bob ').parts).toEqual(['hi ', { id: 'bob' }, ' ']);
		expect(typed('hi @Bob, there').parts).toEqual(['hi ', { id: 'bob' }, ', there']);
		expect(draftText(typed('hi @BOB and').parts)).toBe('hi @bob and');
		// A multi-word name, case-insensitive.
		const both = typed('ask @ada lovelace now');
		expect(both.parts).toEqual(['ask ', { id: 'lovelace' }, ' now']);
		expect(both.caret).toBe('ask @lovelace now'.length);
		// Existing chips stay, and the caret moves across new ones.
		const collapsed = collapseMentions([{ id: 'bob' }, ' and @Ada s'], people, { caret: 15 });
		expect(collapsed.parts).toEqual([{ id: 'bob' }, ' and ', { id: 'ada_1' }, ' s']);
		expect(collapsed.caret).toBe('@bob and @ada_1 s'.length);
	});

	it('waits while a mention is still being typed, and chips one that ends the draft when sending', () => {
		expect(typed('hi @bob').changed).toBe(false);
		// The caret sits inside the mention.
		expect(typed('hi @bob there', 5).changed).toBe(false);
		// "Ada " could still become "Ada Lovelace".
		expect(typed('hi @Ada Lo').changed).toBe(false);
		expect(typed('hi @Ada ').changed).toBe(false);
		// Once it can't, the shorter name is the mention.
		expect(typed('hi @Ada s').parts).toEqual(['hi ', { id: 'ada_1' }, ' s']);
		// Sending ends it.
		expect(typed('hi @bob', 7, true).parts).toEqual(['hi ', { id: 'bob' }]);
		expect(typed('hi @Ada', 7, true).parts).toEqual(['hi ', { id: 'ada_1' }]);
	});

	it('leaves ambiguous names, unknown handles, emails, system IDs and code as text', () => {
		expect(typed('hi @sam there').changed).toBe(false);
		expect(typed('hi @sam_a there').parts).toEqual(['hi ', { id: 'sam_a' }, ' there']);
		expect(typed('hi @nobody there').changed).toBe(false);
		expect(typed('mail ada@bob now').changed).toBe(false);
		expect(typed('from @@system x').changed).toBe(false);
		expect(typed('`@bob` and ```\n@bob\n``` done', 0, true).changed).toBe(false);
		expect(typed('`x` @bob ').parts).toEqual(['`x` ', { id: 'bob' }, ' ']);
	});

	it('chips email and federated IDs whole, and any the directory knows, and no name that what follows would make a longer ID', () => {
		const text = 'cc @ada@example.com, @carol:b.example. ';
		const forms = collapseMentions([text], people, { caret: text.length, isUser: (id) => id === 'ada@example.com' || id === 'carol:b.example' });
		expect(forms.parts).toEqual(['cc ', { id: 'ada@example.com' }, ', ', { id: 'carol:b.example' }, '. ']);
		// Sent as `@bob`, "@Bob.x" would read as `@bob.x` (Appendix A.3).
		expect(typed('hi @Bob.x there').changed).toBe(false);
		expect(typed('hi @Bob@example.com there').changed).toBe(false);
		expect(typed('hi @Bob. there').parts).toEqual(['hi ', { id: 'bob' }, '. there']);
		// Any ID the directory knows, beyond the room.
		const known = collapseMentions(['cc @carol_9 '], people, { caret: 12, isUser: (id) => id === 'carol_9' });
		expect(known.parts).toEqual(['cc ', { id: 'carol_9' }, ' ']);
	});

	it('finds the query at the caret and swaps it for a chip', () => {
		expect(mentionQuery(['hi @ad'], 6)).toEqual({ query: 'ad', start: 3 });
		expect(mentionQuery(['hi @ada lo'], 10)).toEqual({ query: 'ada lo', start: 3 });
		expect(mentionQuery(['hi @'], 4)).toEqual({ query: '', start: 3 });
		expect(mentionQuery(['a@b'], 3)).toBeUndefined();
		// A chip before the caret is not a query.
		expect(mentionQuery([{ id: 'bob' }, ' x'], 6)).toBeUndefined();
		expect(insertMention(['hi @ad!'], 3, 6, 'ada_1')).toEqual({ parts: ['hi ', { id: 'ada_1' }, ' !'], caret: 10 });
		expect(insertMention(['hi @ad there'], 3, 6, 'ada_1')).toEqual({ parts: ['hi ', { id: 'ada_1' }, ' there'], caret: 10 });
		expect(insertMention([], 0, 0, 'bob')).toEqual({ parts: [{ id: 'bob' }, ' '], caret: 5 });
	});
});

describe('draft text', () => {
	it('ends each chip\'s ID where the chip ends', () => {
		expect(draftText([{ id: 'ada' }, '+1'])).toBe('@ada +1');
		expect(draftText([{ id: 'ada' }, '.x and'])).toBe('@ada .x and');
		expect(draftText([{ id: 'ada' }, ':b'])).toBe('@ada :b');
		expect(draftText([{ id: 'ops', room: true }, '-2 is down'])).toBe('#ops -2 is down');
		// Punctuation that cannot end an ID stays where it was typed.
		expect(draftText(['hi ', { id: 'ada' }, '. ', { id: 'bob' }, ', ', { id: 'carol' }, '!'])).toBe('hi @ada. @bob, @carol!');
		expect(draftText([{ id: 'ada' }, '-'])).toBe('@ada-');
		expect(draftText([{ id: 'ada' }, ':-)'])).toBe('@ada:-)');
	});

	it('separates adjacent chips, and a letter or digit from a chip’s prefix, counting caret positions without the added spaces', () => {
		expect(draftText([{ id: 'ada' }, { id: 'bob' }])).toBe('@ada @bob');
		expect(draftText([{ id: 'ada' }, { id: 'ops', room: true }])).toBe('@ada #ops');
		expect(draftText([{ id: 'ops', room: true }, { id: 'ada' }, { id: 'bob' }, '+1'])).toBe('#ops @ada @bob +1');
		// `_` ends an ID, and a `#` after it is still a room.
		expect(draftText([{ id: 'ada_' }, { id: 'ops', room: true }])).toBe('@ada_#ops');
		// Caret positions count without the added spaces.
		expect(draftLength(['hi', { id: 'ada' }, { id: 'bob' }, '+1'])).toBe(12);
		// A letter or digit is kept off a chip's prefix.
		expect(draftText(['hi', { id: 'ada' }])).toBe('hi @ada');
		expect(draftText(['v2', { id: 'ops', room: true }])).toBe('v2 #ops');
		expect(draftText(['(', { id: 'ada' }, ')'])).toBe('(@ada)');
	});

	it('reads back as the chips it was sent from', () => {
		const people = [{ id: 'ada', name: 'Ada' }, { id: 'bob', name: 'Bob' }];
		const parts: DraftPart[] = ['hi', { id: 'ada' }, { id: 'bob' }, '+1'];
		const sent = draftText(parts);
		const read = collapseMentions([sent], people, { caret: sent.length, final: true });
		expect(draftMentions(read.parts)).toEqual(draftMentions(parts));
		expect(draftText(read.parts)).toBe(sent);
	});
});

describe('draft mentions', () => {
	it('lists each chip once, and drops one whose chip was deleted', () => {
		expect(draftMentions(['hi ', { id: 'bob' }, ' and ', { id: 'carol' }, ' and ', { id: 'bob' }])).toEqual(['bob', 'carol']);
		expect(draftMentions(['hi @bob, typed but not picked'])).toEqual([]);
	});
});

describe('inserting at the caret', () => {
	it('puts text at a bare caret, clamped to the draft, and the caret after it, a leading slash left in place', () => {
		expect(insertText(['hello world'], 5, 5, ' 👋')).toEqual({ parts: ['hello 👋 world'], caret: 8 });
		expect(insertText(['hi'], 0, 0, '🎉')).toEqual({ parts: ['🎉hi'], caret: 2 });
		expect(insertText(['hi'], 2, 2, '🎉')).toEqual({ parts: ['hi🎉'], caret: 4 });
		expect(insertText([], 0, 0, '🎉')).toEqual({ parts: ['🎉'], caret: 2 });
		// Positions are clamped to the draft.
		expect(insertText(['hi'], 40, 50, '🎉')).toEqual({ parts: ['hi🎉'], caret: 4 });
		expect(insertText(['hi'], -3, 1, '🎉')).toEqual({ parts: ['🎉i'], caret: 2 });
		// A leading slash stays in place, so a command stays a command.
		expect(draftText(insertText(['/shrug '], 7, 7, '🤷').parts)).toBe('/shrug 🤷');
	});

	it('replaces a selection, whichever way it was made', () => {
		expect(insertText(['hello world'], 6, 11, '🌍')).toEqual({ parts: ['hello 🌍'], caret: 8 });
		expect(insertText(['hello world'], 11, 6, '🌍')).toEqual({ parts: ['hello 🌍'], caret: 8 });
		expect(insertText(['hello world'], 0, 11, '👍')).toEqual({ parts: ['👍'], caret: 2 });
	});

	it('keeps mention chips around the caret', () => {
		const parts = ['hi ', { id: 'bob' }, ' there'];
		// Before, right after, and past the chip (`@bob` is four characters of draft text).
		expect(insertText(parts, 3, 3, '👋')).toEqual({ parts: ['hi 👋', { id: 'bob' }, ' there'], caret: 5 });
		expect(insertText(parts, 7, 7, '👋')).toEqual({ parts: ['hi ', { id: 'bob' }, '👋 there'], caret: 9 });
		expect(insertText(parts, 13, 13, '!')).toEqual({ parts: ['hi ', { id: 'bob' }, ' there!'], caret: 14 });
		// Between two chips.
		expect(insertText([{ id: 'bob' }, { id: 'ada' }], 4, 4, '+')).toEqual({ parts: [{ id: 'bob' }, '+', { id: 'ada' }], caret: 5 });
		expect(draftText(insertText(parts, 7, 7, '👋').parts)).toBe('hi @bob👋 there');
	});

	it('moves a caret inside a chip to after it, and drops a chip the selection cuts into', () => {
		const parts = ['hi ', { id: 'bob' }, ' there'];
		expect(insertText(parts, 5, 5, '👋')).toEqual({ parts: ['hi ', { id: 'bob' }, '👋 there'], caret: 9 });
		expect(insertText(parts, 1, 5, '👋')).toEqual({ parts: ['h👋 there'], caret: 3 });
		expect(insertText(parts, 5, 9, '👋')).toEqual({ parts: ['hi 👋here'], caret: 5 });
		expect(insertText(parts, 2, 8, '')).toEqual({ parts: ['hithere'], caret: 2 });
	});
});

describe('composer room chips', () => {
	const rooms = ['general', '1790473611343', 'ops', 'ops-east'];
	const typedRoom = (text: string, caret = text.length, final = false) => collapseMentions([text], people, { caret, final, rooms });
	const thread = { id: '1790473611343', room: true } as const;

	it('chips a picked room or thread, sends #room_id, and mentions no one', () => {
		const inserted = insertMention(['see #17'], 4, 7, thread.id, true);
		expect(inserted).toEqual({ parts: ['see ', thread, ' '], caret: 19 });
		expect(draftText(inserted.parts)).toBe('see #1790473611343 ');
		expect(draftMentions(['hi ', { id: 'bob' }, ' in ', thread])).toEqual(['bob']);
	});

	it('chips a finished #room_id naming a known room, like a finished @user_id, not one still being typed', () => {
		expect(typedRoom('see #1790473611343 now').parts).toEqual(['see ', thread, ' now']);
		expect(typedRoom('see #general.', 13).parts).toEqual(['see ', { id: 'general', room: true }, '.']);
		// Unknown, mid-word, headings and code stay text.
		expect(typedRoom('see #nope now').parts).toEqual(['see #nope now']);
		expect(typedRoom('a#general now').parts).toEqual(['a#general now']);
		expect(typedRoom('# general').parts).toEqual(['# general']);
		expect(typedRoom('`#general` now').parts).toEqual(['`#general` now']);
		// Straight after a chip, `@bob#general` reads as text to everyone else.
		expect(collapseMentions([{ id: 'bob' }, '#general now'], people, { caret: 16, rooms }).parts).toEqual([{ id: 'bob' }, '#general now']);
		expect(collapseMentions([{ id: 'bob' }, '@ada_1 now'], people, { caret: 14 }).parts).toEqual([{ id: 'bob' }, '@ada_1 now']);
		// Not while it is still being typed.
		expect(typedRoom('see #general').parts).toEqual(['see #general']);
		expect(typedRoom('see #ops-').parts).toEqual(['see #ops-']);
		expect(typedRoom('see #general', 12, true).parts).toEqual(['see ', { id: 'general', room: true }]);
	});
});

describe('backspace against a chip', () => {
	const label = (chip: DraftChip) => (chip.room ? '#Deploy checklist' : '@Ada Lovelace');

	it('turns the chip just before the caret back into the text it showed, and nothing when no chip ends there', () => {
		const parts: DraftPart[] = ['hi ', { id: 'lovelace' }, ' and ', { id: '1790473611343', room: true }];
		// `@lovelace` ends at 12, `#1790473611343` at 31.
		expect(unchip(parts, 12, label)).toEqual({ parts: ['hi @Ada Lovelace and ', { id: '1790473611343', room: true }], caret: 16 });
		expect(unchip(parts, 31, label)).toEqual({ parts: ['hi ', { id: 'lovelace' }, ' and #Deploy checklist'], caret: 34 });
		// No chip ends at the caret: the draft is left alone.
		expect(unchip(parts, 3, label)).toBeUndefined();
		expect(unchip(parts, 14, label)).toBeUndefined();
		expect(unchip([], 0, label)).toBeUndefined();
	});
});
