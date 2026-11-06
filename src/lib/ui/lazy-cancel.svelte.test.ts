// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { cancelWhileWaiting, Lazy, lazyChunk, onLoadFailed } from './lazy.svelte';

describe('cancelWhileWaiting', () => {
	it('lets a popover asked for before its code has come go on Escape or a press anywhere, and only while waiting', () => {
		const cancel = vi.fn();
		expect(cancelWhileWaiting(false, cancel)).toBeUndefined();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(cancel).not.toHaveBeenCalled();

		const stop = cancelWhileWaiting(true, cancel)!;
		// Escape is the waiting popover's, as it would be shown: nothing under it hears it.
		const under = vi.fn();
		document.body.addEventListener('keydown', under);
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(under).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledTimes(1);
		cancel.mockClear();
		document.body.removeEventListener('keydown', under);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
		expect(cancel).not.toHaveBeenCalled();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(cancel).toHaveBeenCalledTimes(1);
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(cancel).toHaveBeenCalledTimes(2);

		// Once its code has come (the effect re-runs), the popover handles these itself.
		stop();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(cancel).toHaveBeenCalledTimes(2);
	});

	it('`once` listens while an ask waits on the code, and stops once the code has come or the ask is gone', async () => {
		const cancel = vi.fn();
		let arrive!: (code: string) => void;
		const lazy = new Lazy(() => new Promise<string>((done) => (arrive = done)));
		expect(lazy.once(true, cancel)).toBeUndefined();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(cancel).toHaveBeenCalledTimes(1);

		// The ask let go (as `cancel` does): nothing listens any more.
		expect(lazy.once(false, cancel)).toBeUndefined();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(cancel).toHaveBeenCalledTimes(1);

		// Asked again, and the code comes: from then on it's the host's to handle.
		lazy.once(true, cancel);
		arrive('code');
		await lazy.whenLoaded();
		expect(lazy.once(true, cancel)).toBe('code');
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it('lets a press on what asked for it through, as the popover once shown does: its click toggles the ask', () => {
		const cancel = vi.fn();
		const row = document.createElement('li');
		row.dataset.pressesAnchor = '';
		const name = document.createElement('button');
		const badge = document.createElement('span');
		row.append(name, badge);
		document.body.append(row);
		const stop = cancelWhileWaiting(true, cancel, name)!;
		name.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
		// The row presses its name (`data-presses-anchor`): a press anywhere on it is one on the anchor.
		badge.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
		expect(cancel).not.toHaveBeenCalled();
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
		expect(cancel).toHaveBeenCalledOnce();
		stop();
		row.remove();
	});
});

describe('a failed load someone asked for', () => {
	const flush = async () => {
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
		flushSync();
	};

	it('is told once for each try, not for the prefetch, and is asked again by what still reads it at the next press', async () => {
		const told = vi.fn();
		const stop = onLoadFailed(told);
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue('code');
		const lazy = new Lazy<string>(load);
		// The background prefetch's failure is nobody's to hear of.
		await expect(lazy.load()).rejects.toThrow('offline');
		expect(told).not.toHaveBeenCalled();

		// A dialog's host, whose open state stays set: `{#if open && lazy.component}`.
		const seen: Array<string | undefined> = [];
		const cleanup = $effect.root(() => {
			$effect(() => void seen.push(lazy.component));
		});
		flushSync();
		await flush();
		expect(told).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledTimes(2);
		// Nothing asks again by itself: only the next press, the next open, does.
		await flush();
		expect(load).toHaveBeenCalledTimes(2);
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await flush();
		expect(load).toHaveBeenCalledTimes(3);
		expect(seen.at(-1)).toBe('code');
		expect(told).toHaveBeenCalledTimes(1);
		cleanup();
		stop();
	});

	it('tells the parts of a chunk asked for together once', async () => {
		const told = vi.fn();
		const stop = onLoadFailed(told);
		const part = lazyChunk<{ a: string; b: string }>(vi.fn().mockRejectedValue(new Error('offline')));
		const a = part((m) => m.a), b = part((m) => m.b);
		void a.component;
		void b.component;
		await flush();
		expect(told).toHaveBeenCalledTimes(1);
		stop();
	});

	it('lets a waiting popover go, so its next ask asks again rather than its anchor closing it', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('code');
		const lazy = new Lazy<string>(load);
		const cancel = vi.fn();
		expect(lazy.once(true, cancel)).toBeUndefined();
		await flush();
		expect(cancel).toHaveBeenCalledTimes(1);
		// Let go: not asked for again until the next ask.
		expect(lazy.once(false, cancel)).toBeUndefined();
		await flush();
		expect(load).toHaveBeenCalledTimes(1);
		lazy.once(true, cancel);
		await lazy.whenLoaded();
		expect(lazy.once(true, cancel)).toBe('code');
	});

	it('waits for the browser to be back online before asking again, while it says it is offline', async () => {
		const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('code');
		const lazy = new Lazy<string>(load);
		const cleanup = $effect.root(() => {
			$effect(() => void lazy.component);
		});
		flushSync();
		await flush();
		document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await flush();
		expect(load).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new Event('online'));
		await flush();
		expect(load).toHaveBeenCalledTimes(2);
		cleanup();
		onLine.mockRestore();
	});
});
