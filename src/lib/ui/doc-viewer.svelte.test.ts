// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { headingFor, MAX_DOC_BYTES, readDoc } from './doc-text';
import { isMarkdownName } from './doc-viewer.svelte';

describe('isMarkdownName', () => {
	it('knows a Markdown file by its name, whatever its case', () => {
		expect(['README.md', 'notes.MD', 'plan.markdown', 'a.mdown', 'b.mkd', ' spaced.md '].map(isMarkdownName)).toEqual([true, true, true, true, true, true]);
		expect(['md', '.md.txt', 'notes.mdx', 'a.txt', 'File', '', undefined].map(isMarkdownName)).toEqual([false, false, false, false, false, false, false]);
	});
});

describe('readDoc', () => {
	const respond = (response: Response | Error) => (async () => {
		if (response instanceof Error) throw response;
		return response;
	}) as unknown as typeof fetch;

	it('reads the file as UTF-8, without a byte order mark', async () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# Café\n')]);
		expect(await readDoc('https://files.example/a.md', undefined, respond(new Response(bytes)))).toEqual({ text: '# Café\n' });
	});

	it('says it is too large past the cap, and unreadable where the server or the network says no', async () => {
		const large = new Response('x', { headers: { 'content-length': String(MAX_DOC_BYTES + 1) } });
		expect(await readDoc('https://files.example/a.md', undefined, respond(large))).toEqual({ error: 'large' });
		expect(await readDoc('https://files.example/a.md', undefined, respond(new Response('gone', { status: 404 })))).toEqual({ error: 'unreadable' });
		// A server that doesn't let this origin read it (CORS) fails as a network error does.
		expect(await readDoc('https://files.example/a.md', undefined, respond(new TypeError('Failed to fetch')))).toEqual({ error: 'unreadable' });
	});
});

describe('headingFor', () => {
	it('finds the heading a link\'s fragment names, as GitHub writes them', () => {
		const page = document.createElement('div');
		page.innerHTML = '<h1>Rollout plan</h1><h2>Getting started (v2)</h2><h3>Café &amp; más</h3><p id="steps">Steps</p>';
		expect(headingFor(page, 'rollout-plan')?.textContent).toBe('Rollout plan');
		expect(headingFor(page, 'getting-started-v2')?.textContent).toBe('Getting started (v2)');
		expect(headingFor(page, 'caf%C3%A9--m%C3%A1s')?.textContent).toBe('Café & más');
		expect(headingFor(page, 'steps')).toBeUndefined();
		expect(headingFor(page, '%E0%A4%A')).toBeUndefined();
	});
});
