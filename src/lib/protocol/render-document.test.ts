// @vitest-environment jsdom
import DOMPurify from 'dompurify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDocument } from './markdown';
import type { MediaCheck } from './sanitize';

/** Media from nowhere, as a gate that lets nothing load says. */
const nowhere: MediaCheck = { key: 'none', src: () => undefined };

afterEach(() => {
	vi.restoreAllMocks();
});

/** `markdown` rendered, as a document in a box to query. */
function rendered(markdown: string): HTMLElement {
	const box = document.createElement('div');
	box.innerHTML = renderDocument(markdown, nowhere);
	return box;
}

describe('renderDocument', () => {
	it('renders a file as a message is, but leaves names, rooms and emoji keys as written', () => {
		const box = rendered('# Plan\n\nAsk @grace in #general :tada:\n\n```ts\nconst a = 1;\n```');
		expect(box.querySelector('h1')?.textContent).toBe('Plan');
		expect(box.querySelector('p')?.textContent).toBe('Ask @grace in #general :tada:');
		expect(box.querySelector('pre code.language-ts')).not.toBeNull();
		expect(box.querySelector('script, [data-user-id], [data-room-id]')).toBeNull();
	});

	it('keeps links to places of their own and to its headings, and makes relative ones their text', () => {
		const box = rendered('[site](https://example.com/a) [mail](mailto:a@example.com) [steps](#steps) [setup](./setup.md) [docs](/docs) [up](../README.md)');
		const links = [...box.querySelectorAll('a')].map((link) => [link.textContent, link.getAttribute('href')]);
		expect(links).toEqual([['site', 'https://example.com/a'], ['mail', 'mailto:a@example.com'], ['steps', '#steps']]);
		expect(box.textContent?.trim()).toBe('site mail steps setup docs up');
		expect(box.querySelector('a[href^="https"]')?.getAttribute('target')).toBe('_blank');
	});

	it('is sanitized, and keeps nothing for later: the same file is sanitized again each time', () => {
		const sanitize = vi.spyOn(DOMPurify, 'sanitize');
		const markdown = '[x](javascript:alert(1)) <img src=x onerror=alert(1)>';
		const box = rendered(markdown);
		// Neither a link nor a picture: the script link and the raw HTML stay text.
		expect(box.querySelector('a, img, [onerror]')).toBeNull();
		rendered(markdown);
		expect(sanitize).toHaveBeenCalledTimes(2);
	});
});
