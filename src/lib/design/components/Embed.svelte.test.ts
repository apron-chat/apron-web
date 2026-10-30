// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import EmbedCard from './EmbedCard.svelte';
import EmbedFrame from './EmbedFrame.svelte';
import EmbedStream from './EmbedStream.svelte';
import EmbedUpload from './EmbedUpload.svelte';
import { render, unmount } from '$lib/test/dom';
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
	it('shows a card without its picture, and under it Load and Always load, each doing its own', () => {
		const onload = vi.fn();
		const ontrust = vi.fn();
		render(EmbedCard, { kind: 'link', url: 'https://news.example/story', testid: 'card', og: { title: 'A story', image: { alt: 'Chart', ask: { host: 'cdn.example', onload, ontrust } } } });
		expect(document.querySelector('[data-testid="card"]')?.classList.contains('ap-embed-held')).toBe(true);
		expect(document.querySelector('img')).toBeNull();
		const ask = () => [document.querySelector('.ap-media-ask-label')?.textContent, ...[...document.querySelectorAll('.ap-media-ask button')].map((button) => button.textContent)];
		expect(ask()).toEqual(['Chart cdn.example', 'Load', 'Always load from cdn.example']);
		document.querySelector<HTMLButtonElement>('[aria-label="Load Chart from cdn.example"]')!.click();
		expect(onload).toHaveBeenCalledOnce();
		document.querySelector<HTMLButtonElement>('button[title="Adds cdn.example to Trusted origins"]')!.click();
		expect(ontrust).toHaveBeenCalledOnce();
		unmount();
		// An upload's preview: its file card, and the one that would show first; no Always load where it can't be.
		render(EmbedUpload, { kind: 'upload', url: 'https://files.example/a.mp4', title: 'a.mp4', og: { video: { ask: { host: 'plain.example', onload } }, image: { ask: { host: 'plain.example', onload } } } });
		expect(document.querySelector('.ap-embed-file')).not.toBeNull();
		expect(ask()).toEqual(['Video plain.example', 'Load']);
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

describe('EmbedStream', () => {
	it('names itself by its title, and says how it stopped', () => {
		render(EmbedStream, { kind: 'stream', title: 'Build', url: '#', done: true, status: 'Ended', text: 'ok' });
		expect(document.querySelector('.ap-embed-streamkind')?.textContent).toBe('Build');
		expect(detail()).toBe('Ended');
		expect(document.querySelector('.ap-embed-stream-live')).toBeNull();
	});
});
