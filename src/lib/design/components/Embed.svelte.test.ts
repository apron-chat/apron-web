// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import EmbedFrame from './EmbedFrame.svelte';
import Embed from './Embed.svelte';
import EmbedTerminal from './EmbedTerminal.svelte';
import EmbedUpload from './EmbedUpload.svelte';
import { render, unmount } from '$lib/test/dom';

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
		render(EmbedUpload, { kind: 'upload', url: 'https://files.example/a.png', title: 'a.png', og: { image: { url: PIXEL } }, onview, viewer: { src: PIXEL, title: 'a.png', detail: 'Ada · 4:00 PM', width: 960, height: 600 } });
		const link = document.querySelector<HTMLAnchorElement>('a.ap-embed-imagelink')!;
		expect([link.dataset.viewerSrc, link.dataset.viewerTitle, link.dataset.viewerDetail, link.dataset.viewerWidth, link.dataset.viewerHeight, link.hasAttribute('data-viewer-alt')]).toEqual([PIXEL, 'a.png', 'Ada · 4:00 PM', '960', '600', false]);
		expect([link.title, link.getAttribute('aria-haspopup')]).toEqual(['View a.png', 'dialog']);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(onview).toHaveBeenCalledOnce();
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
