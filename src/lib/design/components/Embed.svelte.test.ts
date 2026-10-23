// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import EmbedFrame from './EmbedFrame.svelte';
import EmbedStream from './EmbedStream.svelte';
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

	it('puts the link attributes on the picture, and a plain click views it', () => {
		const onview = vi.fn();
		render(EmbedUpload, { kind: 'upload', url: 'https://files.example/a.png', title: 'a.png', og: { image: { url: PIXEL } }, onview, link: { 'data-viewer-src': PIXEL } });
		const link = document.querySelector<HTMLAnchorElement>('a.ap-embed-imagelink')!;
		expect([link.dataset.viewerSrc, link.title, link.getAttribute('aria-haspopup')]).toEqual([PIXEL, 'View a.png', 'dialog']);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(onview).toHaveBeenCalledOnce();
	});
});

describe('EmbedFrame', () => {
	it('keeps its own sandbox, referrer policy and permissions over any the caller passes', () => {
		render(EmbedFrame, { kind: 'iframe', url: 'https://view.example/live', live: true, sandbox: 'allow-scripts allow-same-origin allow-top-navigation', referrerpolicy: 'unsafe-url', allow: 'camera; microphone', class: 'mine' } as never);
		const frame = document.querySelector('iframe')!;
		expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
		expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
		expect(frame.getAttribute('allow')).toBe('');
		expect(frame.classList.contains('mine')).toBe(true);
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
