import { describe, expect, it } from 'vitest';
import { draftFacts, sameFacts } from './compose';

describe('the facts of a draft', () => {
	it('tells blank, past one line, a command and a link apart', () => {
		expect(draftFacts('')).toEqual({ blank: true, multiline: false, command: false, linked: false });
		expect(draftFacts('  \n ')).toEqual({ blank: true, multiline: true, command: false, linked: false });
		expect(draftFacts('/me waves')).toMatchObject({ blank: false, command: true });
		// `//` posts a message that starts with `/`.
		expect(draftFacts('//not a command').command).toBe(false);
		expect(draftFacts('see https://example.com').linked).toBe(true);
		expect(draftFacts('see example.com').linked).toBe(false);
	});

	it('are the same for drafts that differ only in what no fact reads, as typing on a line does', () => {
		expect(sameFacts(draftFacts('hello'), draftFacts('hello there'))).toBe(true);
		expect(sameFacts(draftFacts('hello'), draftFacts('hello\nthere'))).toBe(false);
		expect(sameFacts(draftFacts('hello'), draftFacts(''))).toBe(false);
	});
});
