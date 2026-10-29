import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { filterAtCaret, matchesTerms, newestMatches, parseQuery, queryMatcher, searchPeople, searchTerms, snippet, withFilterValue, type SearchContext } from './search';

const message = (id: string, text: string, log = id, fields: Partial<MessageRecord> = {}): MessageRecord => ({ message_id: id, log_id: log, room_id: 'general', from: { user_id: 'ada' }, body: { text }, ...fields });

describe('searchTerms and matchesTerms', () => {
	it('matches a message holding every word, in any case and with or without accents', () => {
		const terms = searchTerms('  Café   DEPLOY café ');
		expect(terms).toEqual(['cafe', 'deploy']);
		expect(matchesTerms(message('1', 'The deploy is at the CAFÉ'), terms)).toBe(true);
		expect(matchesTerms(message('2', 'The deploy is at noon'), terms)).toBe(false);
		expect(matchesTerms(message('3', 'deploying from the cafeteria'), terms)).toBe(true);
	});

	it('never matches a deleted message, one without text, or an empty query', () => {
		expect(matchesTerms(message('1', 'deploy', '2', { deleted: true }), ['deploy'])).toBe(false);
		expect(matchesTerms({ ...message('1', ''), body: {} }, ['deploy'])).toBe(false);
		expect(matchesTerms(message('1', 'deploy'), searchTerms('   '))).toBe(false);
	});
});

describe('newestMatches', () => {
	it('keeps each message once, as its latest snapshot, newest posted first, up to the limit', () => {
		const kept = [message('10', 'old text'), message('30', 'third')];
		const loaded = [message('10', 'edited text', '40'), message('20', 'second')];
		const { messages, more } = newestMatches([kept, loaded], 2);
		expect(messages.map((found) => [found.message_id, found.body?.text])).toEqual([['30', 'third'], ['20', 'second']]);
		expect(more).toBe(true);
		expect(newestMatches([kept, loaded]).messages.find((found) => found.message_id === '10')?.body?.text).toBe('edited text');
	});
});

describe('snippet', () => {
	const text = (parts: { text: string; match: boolean }[]) => parts.map((part) => (part.match ? `[${part.text}]` : part.text)).join('');

	it('marks each word searched for, as written, accents and all', () => {
		expect(text(snippet('Meet at the Café, then deploy.', ['cafe', 'deploy']))).toBe('Meet at the [Café], then [deploy].');
	});

	it('shows about `width` characters around the first match on one line, cut at words', () => {
		const long = `${'lorem ipsum '.repeat(20)}the deploy\nfailed ${'dolor sit '.repeat(20)}`;
		const shown = text(snippet(long, ['deploy'], 60));
		expect(shown.startsWith('…')).toBe(true);
		expect(shown.endsWith('…')).toBe(true);
		expect(shown).toContain('the [deploy] failed');
		expect(shown.length).toBeLessThanOrEqual(64);
		expect(shown).not.toContain('\n');
	});

	it('starts at the beginning when the match is near it', () => {
		expect(text(snippet('deploy now', ['deploy']))).toBe('[deploy] now');
	});
});

describe('parseQuery', () => {
	it('takes user: and room: as filters, by id or name, quoted with spaces, and the rest as words', () => {
		expect(parseQuery('deploy user:@Ada room:#General')).toEqual({ terms: ['deploy'], users: ['ada'], rooms: ['general'] });
		expect(parseQuery('USER:"Ada Lovelace" user:bob room:"Deploy checklist" late')).toEqual({ terms: ['late'], users: ['ada lovelace', 'bob'], rooms: ['deploy checklist'] });
		expect(parseQuery('room:ops room:#OPS')).toMatchObject({ rooms: ['ops'] });
	});

	it('keeps anything else with a colon as words, and drops an empty filter', () => {
		expect(parseQuery('at 14:30 https://example.com user:')).toEqual({ terms: ['at', '14:30', 'https://example.com'], users: [], rooms: [] });
		expect(parseQuery('nouser:ada')).toMatchObject({ terms: ['nouser:ada'], users: [] });
	});
});

describe('queryMatcher', () => {
	const ada = { user_id: 'ada', name: 'Ada Lovelace' };
	const context: SearchContext = {
		users: [ada, { user_id: 'bob', name: 'Bob' }],
		rooms: [{ id: 'general', title: 'General' }, { id: 'thread_deploy', title: 'Deploy checklist', parentRoomId: 'general' }, { id: 'ops', title: 'Ops' }],
		parentOf: (roomId) => (roomId === 'thread_unseen' ? 'general' : undefined)
	};
	const sent = (id: string, room: string, from: { user_id: string; name?: string }, text = 'the deploy is done') => message(id, text, id, { room_id: room, from });
	const ids = (query: string, messages: MessageRecord[]) => messages.filter(queryMatcher(parseQuery(query), context)!).map((found) => found.message_id);
	const all = [
		sent('1', 'general', ada), sent('2', 'thread_deploy', { user_id: 'bob' }), sent('3', 'ops', ada, 'lunch?'),
		sent('4', 'thread_unseen', { user_id: 'carol', name: 'Carol' }), sent('5', 'elsewhere', { user_id: 'dave' })
	];

	it('keeps what a user sent, by @user_id or by name, as known or as the message carries it', () => {
		expect(ids('user:@ada', all)).toEqual(['1', '3']);
		expect(ids('user:"ada lovelace" deploy', all)).toEqual(['1']);
		expect(ids('user:carol', all)).toEqual(['4']);
		expect(ids('user:@ada user:bob', all)).toEqual(['1', '2', '3']);
	});

	it('keeps what is in a room and its threads, by #room_id or title, shown or not', () => {
		expect(ids('room:#general', all)).toEqual(['1', '2', '4']);
		expect(ids('room:"deploy checklist"', all)).toEqual(['2']);
		expect(ids('room:#elsewhere', all)).toEqual(['5']);
		expect(ids('room:#general user:bob', all)).toEqual(['2']);
	});

	it('asks for nothing without words or filters, and never keeps a deleted message', () => {
		expect(queryMatcher(parseQuery('  '), context)).toBeUndefined();
		expect(queryMatcher(parseQuery('user:@ada'), context)!(message('9', 'x', '10', { from: ada, deleted: true }))).toBe(false);
	});
});

describe('filterAtCaret and withFilterValue', () => {
	it('finds the user: or room: value the caret is in, with or without its @ or #', () => {
		expect(filterAtCaret('deploy user:@ad', 15)).toEqual({ kind: 'users', start: 12, end: 15, typed: 'ad' });
		expect(filterAtCaret('room:gen', 8)).toEqual({ kind: 'rooms', start: 5, end: 8, typed: 'gen' });
		expect(filterAtCaret('ROOM:#', 6)).toEqual({ kind: 'rooms', start: 5, end: 6, typed: '' });
		// The caret mid-value: what's typed is what is before it, and the value runs on to the next space.
		expect(filterAtCaret('user:@adam late', 8)).toEqual({ kind: 'users', start: 5, end: 10, typed: 'ad' });
	});

	it('finds nothing in a word, past a space, or in a quoted name', () => {
		expect(filterAtCaret('deploy', 6)).toBeUndefined();
		expect(filterAtCaret('user:@ada ', 10)).toBeUndefined();
		expect(filterAtCaret('nouser:ad', 9)).toBeUndefined();
		expect(filterAtCaret('user:"Ada', 9)).toBeUndefined();
	});

	it('puts a value in with a space after it, and the caret after that', () => {
		const at = filterAtCaret('deploy user:@ad late', 15)!;
		expect(withFilterValue('deploy user:@ad late', at, '@ada')).toEqual({ query: 'deploy user:@ada late', caret: 17 });
		const end = filterAtCaret('room:ge', 7)!;
		expect(withFilterValue('room:ge', end, '#general')).toEqual({ query: 'room:#general ', caret: 14 });
	});
});

describe('searchPeople', () => {
	const people = [{ id: 'adam', name: 'Adam' }, { id: 'ada', name: 'Ada Lovelace' }, { id: 'zoe', name: 'Zoë Cadabra' }, { id: 'bob' }];
	it('lists someone named exactly first, then by name or id starting with what is typed, then holding it', () => {
		expect(searchPeople(people, 'ada').map((person) => person.id)).toEqual(['ada', 'adam', 'zoe']);
		expect(searchPeople(people, 'zoe').map((person) => person.id)).toEqual(['zoe']);
		expect(searchPeople(people, '').map((person) => person.id)).toEqual(['ada', 'adam', 'bob', 'zoe']);
		expect(searchPeople(people, 'a', 2)).toHaveLength(2);
	});
});
