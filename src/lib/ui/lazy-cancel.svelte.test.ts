// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cancelWhileWaiting, Lazy } from './lazy.svelte';

describe('cancelWhileWaiting', () => {
	it('lets a popover asked for before its code has come go on Escape or a press anywhere, and only while waiting', () => {
		const cancel = vi.fn();
		expect(cancelWhileWaiting(false, cancel)).toBeUndefined();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(cancel).not.toHaveBeenCalled();

		const stop = cancelWhileWaiting(true, cancel)!;
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
});
