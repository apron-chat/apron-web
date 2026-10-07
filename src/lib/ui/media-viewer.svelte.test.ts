// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import MediaViewer from '$lib/design/components/MediaViewer.svelte';
import { plainClick } from '$lib/design/components/util';
import EmbedUpload from '$lib/components/embeds/EmbedUpload.svelte';
import { gallery, mediaItemOf, mediaViewer } from './media-viewer.svelte';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

// jsdom has <dialog> without its modal methods: enough of them to open and close.
beforeAll(() => {
	const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal(): void; close(): void };
	proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
	proto.close ??= function (this: HTMLDialogElement) {
		if (!this.hasAttribute('open')) return;
		this.removeAttribute('open');
		this.dispatchEvent(new Event('close'));
	};
});

let instance: ReturnType<typeof mount> | undefined;
afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	mediaViewer.open = false;
});

function link(src: string, title: string, extra = ''): string {
	return `<a href="https://files.example/${title}" data-viewer-src="${src}" data-viewer-title="${title}" ${extra}>${title}</a>`;
}

describe('plainClick', () => {
	it('takes only the main button with no modifier', () => {
		expect(plainClick(new MouseEvent('click', { button: 0 }))).toBe(true);
		for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
			expect(plainClick(new MouseEvent('click', { button: 0, ...init })), JSON.stringify(init)).toBe(false);
		}
	});
});

describe('gallery', () => {
	it('pages through the images in the same timeline, in order, from the one clicked', () => {
		document.body.innerHTML = `<div class="ap-timeline">${link('a.png', 'a.png', 'data-viewer-detail="Ada · 4:00 PM" data-viewer-width="960" data-viewer-height="600"')}<a data-viewer-title="no-src">x</a>${link('b.png', 'b.png')}${link('c.png', 'c.png', 'data-viewer-alt="A ridge"')}</div>${link('elsewhere.png', 'elsewhere.png')}`;
		const links = [...document.querySelectorAll<HTMLElement>('.ap-timeline [data-viewer-src]')];
		const found = gallery(links[1]);
		expect(found.index).toBe(1);
		expect(found.items).toEqual([
			{ src: 'a.png', title: 'a.png', detail: 'Ada · 4:00 PM', href: 'https://files.example/a.png', width: 960, height: 600 },
			{ src: 'b.png', title: 'b.png', href: 'https://files.example/b.png' },
			{ src: 'c.png', title: 'c.png', alt: 'A ridge', href: 'https://files.example/c.png' }
		]);
		expect(mediaItemOf(document.querySelector<HTMLElement>('[data-viewer-title="no-src"]')!)).toBeUndefined();
	});

	it('gives focus back to the image last shown when it closes', () => {
		document.body.innerHTML = `<div class="ap-timeline">${link('a.png', 'a.png')}${link('b.png', 'b.png')}</div>`;
		const [first, second] = document.querySelectorAll<HTMLElement>('[data-viewer-src]');
		mediaViewer.show(first);
		expect([mediaViewer.open, mediaViewer.index, mediaViewer.items.length]).toEqual([true, 0, 2]);
		mediaViewer.index = 1;
		mediaViewer.closed();
		expect(mediaViewer.open).toBe(false);
		expect(document.activeElement).toBe(second);
	});
});

describe('MediaViewer', () => {
	it('shows one image with where it is among them, pages with the arrow keys, and closes', async () => {
		const onclose = vi.fn();
		const props = $state({
			open: true,
			index: 0,
			items: [
				{ src: PIXEL, title: 'dusk.jpg', detail: 'Grace Hopper · 4:00 PM', href: 'https://files.example/dusk.jpg' },
				{ src: PIXEL, title: 'dawn.jpg' }
			],
			onclose
		});
		instance = mount(MediaViewer, { target: document.body, props });
		flushSync();
		const dialog = document.querySelector('dialog')!;
		expect(dialog.hasAttribute('open')).toBe(true);
		expect(dialog.querySelector('h2')?.textContent).toBe('dusk.jpg');
		expect(dialog.querySelector('.ap-viewer-count')?.textContent).toBe('1 of 2');
		expect(dialog.querySelector<HTMLAnchorElement>('a.ap-viewer-btn')?.href).toBe('https://files.example/dusk.jpg');
		expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Previous image"]')?.disabled).toBe(true);

		dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		flushSync();
		expect(props.index).toBe(1);
		expect(dialog.querySelector('h2')?.textContent).toBe('dawn.jpg');
		expect(dialog.querySelector('.ap-viewer-count')?.textContent).toBe('2 of 2');
		expect(dialog.querySelector<HTMLButtonElement>('[aria-label="Next image"]')?.disabled).toBe(true);
		// No original to open for this one.
		expect(dialog.querySelector('a.ap-viewer-btn')).toBeNull();

		dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
		flushSync();
		await tick();
		expect(props.open).toBe(false);
		expect(onclose).toHaveBeenCalledOnce();
	});
});

describe('an image upload', () => {
	const embed = { kind: 'upload', url: 'https://files.example/dusk.jpg', title: 'dusk.jpg', og: { image: { url: PIXEL, width: 960, height: 600 } } };

	it('opens in the viewer on a plain click, and stays a link on a Cmd or Ctrl click', () => {
		instance = mount(EmbedUpload, { target: document.body, props: { embed, detail: 'Grace Hopper · 4:00 PM' } });
		flushSync();
		const anchor = document.querySelector<HTMLAnchorElement>('a.ap-embed-imagelink')!;
		expect(anchor.target).toBe('_blank');

		for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
			const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...modifier });
			anchor.dispatchEvent(click);
			expect(click.defaultPrevented, JSON.stringify(modifier)).toBe(false);
			expect(mediaViewer.open).toBe(false);
		}

		const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		anchor.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(mediaViewer.open).toBe(true);
		expect(mediaViewer.items).toEqual([{ src: PIXEL, title: 'dusk.jpg', detail: 'Grace Hopper · 4:00 PM', href: 'https://files.example/dusk.jpg', width: 960, height: 600 }]);
	});
});
