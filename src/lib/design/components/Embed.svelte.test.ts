// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import EmbedCard from './EmbedCard.svelte';
import EmbedFrame from './EmbedFrame.svelte';
import Embed from './Embed.svelte';
import EmbedTerminal from './EmbedTerminal.svelte';
import EmbedUpload from './EmbedUpload.svelte';
import { button, queryByRole, render, touch, unmount } from '$lib/test/dom';
import { media } from '$lib/test/media';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

function detail(): string | null | undefined {
	return document.querySelector('.ap-embed-detail')?.textContent;
}

describe('EmbedUpload', () => {
	it('says what is pending: its size, its progress, or why it failed', () => {
		render(EmbedUpload, { kind: 'upload', title: 'a.png', detail: '960 × 600', progress: 0.5 });
		expect(detail()).toBe('960 × 600 · Uploading · 50%');
		expect(document.querySelector('.ap-embed-progress')).not.toBeNull();
		unmount();
		render(EmbedUpload, { kind: 'upload', title: 'a.png', detail: '960 × 600', progress: 0.5, failed: 'too large' });
		expect(detail()).toBe('Upload failed · too large');
		expect(document.querySelector('.ap-embed-progress')).toBeNull();
	});

	it('puts what a viewer shows on the picture\'s link, and a plain click views it', () => {
		const onview = vi.fn();
		render(EmbedUpload, { kind: 'upload', url: 'https://files.example/a.png', title: 'a.png', og: { image: { url: media(PIXEL) } }, onview, viewer: { src: media(PIXEL), title: 'a.png', detail: 'Ada · 4:00 PM', width: 960, height: 600 } });
		const link = document.querySelector<HTMLAnchorElement>('a.ap-embed-imagelink')!;
		expect([link.dataset.viewerSrc, link.dataset.viewerTitle, link.dataset.viewerDetail, link.dataset.viewerWidth, link.dataset.viewerHeight, link.hasAttribute('data-viewer-alt')]).toEqual([PIXEL, 'a.png', 'Ada · 4:00 PM', '960', '600', false]);
		expect([link.title, link.getAttribute('aria-haspopup')]).toEqual(['View a.png', 'dialog']);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(onview).toHaveBeenCalledOnce();
	});
});

describe('media that waits for a click', () => {
	it('shows a card without its picture, and under it Load, Always load and Block, each doing its own', () => {
		const onload = vi.fn();
		const ontrust = vi.fn();
		const onblock = vi.fn();
		render(EmbedCard, { kind: 'link', url: 'https://news.example/story', testid: 'card', og: { title: 'A story', image: { alt: 'Chart', ask: { url: 'https://cdn.example/chart.png', host: 'cdn.example', onload, ontrust, onblock } } } });
		expect(document.querySelector('[data-testid="card"]')?.classList.contains('ap-embed-held')).toBe(true);
		expect(document.querySelector('img')).toBeNull();
		const ask = () => [document.querySelector('.ap-media-ask-label')?.textContent, ...[...document.querySelectorAll('.ap-media-ask button')].map((button) => button.textContent)];
		expect(ask()).toEqual(['Chart https://cdn.example/chart.png', 'Load', 'Always load from cdn.example', 'Block cdn.example']);
		document.querySelector<HTMLButtonElement>('[aria-label="Load Chart from cdn.example"]')!.click();
		expect(onload).toHaveBeenCalledOnce();
		document.querySelector<HTMLButtonElement>('button[title="Adds cdn.example to Trusted origins"]')!.click();
		expect(ontrust).toHaveBeenCalledOnce();
		document.querySelector<HTMLButtonElement>('button[title="Adds cdn.example to Blocked origins"]')!.click();
		expect(onblock).toHaveBeenCalledOnce();
		unmount();
		// An upload's preview: its file card, and the one that would show first; no Always load where it can't be.
		render(EmbedUpload, { kind: 'upload', url: 'https://files.example/a.mp4', title: 'a.mp4', og: { video: { ask: { url: 'http://plain.example/a.mp4', host: 'plain.example', onload } }, image: { ask: { url: 'http://plain.example/a.png', host: 'plain.example', onload } } } });
		expect(document.querySelector('.ap-embed-file')).not.toBeNull();
		expect(ask()).toEqual(['Video http://plain.example/a.mp4', 'Load']);
	});
});

describe('EmbedFrame', () => {
	it('is sandboxed with scripts only, no referrer and no permissions, and takes a class and test id', () => {
		render(EmbedFrame, { kind: 'iframe', url: 'https://view.example/live', live: true, class: 'mine', testid: 'frame' });
		const frame = document.querySelector('iframe')!;
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
		expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(frame.getAttribute('allow')).toBe('');
		expect(frame.classList.contains('mine')).toBe(true);
		expect(frame.dataset.testid).toBe('frame');
	});

	it('is a fallback card without a usable address', () => {
		render(EmbedFrame, { kind: 'iframe', url: 'javascript:alert(1)' });
		expect(document.querySelector('.ap-embed-fallback .ap-embed-kind')?.textContent).toBe('iframe');
		expect(detail()).toBe('This live view has no usable address.');
	});
});

describe('EmbedTerminal', () => {
	it('names itself by its title, and says how it stopped', () => {
		render(EmbedTerminal, { kind: 'terminal', title: 'make test', url: '#', done: true, status: 'Ended', text: 'ok' });
		expect(document.querySelector('.ap-embed-termtitle')?.textContent).toBe('make test');
		expect(detail()).toBe('Ended');
		expect(document.querySelector('.ap-embed-terminal-live')).toBeNull();
	});

	it('is live while it has a url and is not done, and says so', () => {
		render(EmbedTerminal, { kind: 'terminal', url: '#' });
		expect(document.querySelector('.ap-embed-termtitle')?.textContent).toBe('Terminal');
		expect(document.querySelector('.ap-embed-livebadge')?.textContent).toBe('Live');
		expect(document.querySelector('.ap-embed-terminal-live')).not.toBeNull();
	});

	it('hands its screen to `attach`, left to right whatever the page, or else shows its text as it is', () => {
		const attach = vi.fn();
		render(EmbedTerminal, { kind: 'terminal', output: 'x', attach });
		const screen = document.querySelector<HTMLElement>('.ap-embed-termscreen')!;
		expect(attach).toHaveBeenCalledWith(screen);
		expect([screen.tagName, screen.dir, screen.textContent]).toEqual(['DIV', 'ltr', '']);
		unmount();
		render(EmbedTerminal, { kind: 'terminal', text: '$ make\nok' });
		expect(document.querySelector('pre.ap-embed-termscreen')?.textContent).toBe('$ make\nok');
	});

	it('offers Expand, a labeled button in its header, only with `onexpand`, which it calls with that button', () => {
		render(EmbedTerminal, { kind: 'terminal', url: '#', attach: vi.fn() });
		expect(queryByRole('button', 'Expand terminal')).toBeNull();
		unmount();
		const onexpand = vi.fn();
		render(EmbedTerminal, { kind: 'terminal', url: '#', attach: vi.fn(), onexpand });
		const expand = button('Expand terminal');
		expect(expand.closest('.ap-embed-termhead')).not.toBeNull();
		expect([expand.type, expand.title, expand.getAttribute('aria-haspopup')]).toEqual(['button', 'Expand', 'dialog']);
		expand.click();
		expect(onexpand).toHaveBeenCalledExactlyOnceWith(expand);
	});

	it('expands on a tap on its screen, on a touch screen, and leaves a mouse’s click to select', () => {
		const onexpand = vi.fn();
		render(EmbedTerminal, { kind: 'terminal', url: '#', attach: vi.fn(), onexpand });
		const screen = document.querySelector<HTMLElement>('.ap-embed-termscreen')!;
		// The terminal drawn inside it, which the tap lands on.
		const row = screen.appendChild(document.createElement('span'));
		row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		row.click();
		expect(onexpand).not.toHaveBeenCalled();
		touch('pointerdown', row);
		row.click();
		expect(onexpand).toHaveBeenCalledExactlyOnceWith(button('Expand terminal'));
	});
});

describe('Embed', () => {
	it('draws a terminal as a terminal, and nothing for append, whose text continues the body (§4.8.5)', () => {
		render(Embed, { kind: 'terminal', title: 'build' });
		expect(document.querySelector('.ap-embed-terminal')).not.toBeNull();
		unmount();
		const box = render(Embed, { kind: 'append', url: 'https://chat.example/a/1' });
		expect(box.innerHTML.replace(/<!--[^]*?-->/g, '')).toBe('');
	});

	it('draws a kind it does not know, such as the retired stream, as the fallback card', () => {
		render(Embed, { kind: 'stream', url: 'https://chat.example/s/1' });
		expect(document.querySelector('.ap-embed-fallback .ap-embed-kind')?.textContent).toBe('stream');
	});
});
