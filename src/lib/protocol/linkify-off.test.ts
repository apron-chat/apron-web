import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { renderMarkdown } from './markdown';

// linkify-it is aliased to a stub (vite.config.ts), here as in the app: markdown-it must never be asked to linkify.
describe('the linkify-it stub', () => {
	it('is what markdown-it gets, and says so if linkify is turned on', () => {
		expect(() => new MarkdownIt({ linkify: true }).render('see https://example.com')).toThrow(/linkify-it is stubbed out/);
	});

	it('leaves bare links to Apron’s own linking', () => {
		expect(renderMarkdown('see https://example.com/a')).toContain('href="https://example.com/a"');
	});
});
