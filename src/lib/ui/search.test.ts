import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '$lib/protocol/types';
import { matchesTerms, newestMatches, searchTerms, snippet } from './search';

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
