// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EmbedFrame from './EmbedFrame.svelte';
import EmbedStream from './EmbedStream.svelte';
import EmbedUpload from './EmbedUpload.svelte';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function detail(): string | null | undefined {
	return document.querySelector('.ap-embed-detail')?.textContent;
}

describe('EmbedUpload', () => {
	it('says what is pending: its size, its progress, or why it failed', () => {
		instance = mount(EmbedUpload, { target: document.body, props: { kind: 'upload', title: 'a.png', detail: '960 × 600', progress: 0.5, 'data-testid': 'pending' } });
		flushSync();
		expect(detail()).toBe('960 × 600 · Uploading · 50%');
		expect(document.querySelector('[data-testid="pending"] .ap-embed-progress')).not.toBeNull();
		unmount(instance);
		instance = mount(EmbedUpload, { target: document.body, props: { kind: 'upload', title: 'a.png', detail: '960 × 600', progress: 0.5, failed: 'too large' } });
		flushSync();
		expect(detail()).toBe('Upload failed · too large');
		expect(document.querySelector('.ap-embed-progress')).toBeNull();
	});

	it('puts the link attributes on the picture, and a plain click views it', () => {
		const onview = vi.fn();
		instance = mount(EmbedUpload, { target: document.body, props: { kind: 'upload', url: 'https://files.example/a.png', title: 'a.png', og: { image: { url: PIXEL } }, onview, link: { 'data-viewer-src': PIXEL } } });
		flushSync();
		const link = document.querySelector<HTMLAnchorElement>('a.ap-embed-imagelink')!;
		expect([link.dataset.viewerSrc, link.title, link.getAttribute('aria-haspopup')]).toEqual([PIXEL, 'View a.png', 'dialog']);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		link.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(onview).toHaveBeenCalledOnce();
	});
});

describe('EmbedFrame', () => {
	it('is a fallback card without a usable address', () => {
		instance = mount(EmbedFrame, { target: document.body, props: { kind: 'iframe', url: 'javascript:alert(1)' } });
		flushSync();
		expect(document.querySelector('.ap-embed-fallback .ap-embed-kind')?.textContent).toBe('iframe');
		expect(detail()).toBe('This live view has no usable address.');
	});
});

describe('EmbedStream', () => {
	it('names itself by its title, and says how it stopped', () => {
		instance = mount(EmbedStream, { target: document.body, props: { kind: 'stream', title: 'Build', url: '#', done: true, status: 'Ended', text: 'ok' } });
		flushSync();
		expect(document.querySelector('.ap-embed-streamkind')?.textContent).toBe('Build');
		expect(detail()).toBe('Ended');
		expect(document.querySelector('.ap-embed-stream-live')).toBeNull();
	});
});
