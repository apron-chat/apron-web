// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lazy, prefetchLazy } from './lazy.svelte';

afterEach(() => {
	vi.useRealTimers();
});

describe('prefetchLazy', () => {
	it('fetches what the page may open soon once it settles, but not what is seldom opened (`prefetch: false`)', async () => {
		vi.useFakeTimers();
		const often = vi.fn(async () => 'dialog');
		const seldom = vi.fn(async () => 'viewer');
		new Lazy(often);
		const rare = new Lazy(seldom, { prefetch: false });
		prefetchLazy();
		await vi.runAllTimersAsync();
		expect([often.mock.calls.length, seldom.mock.calls.length]).toEqual([1, 0]);
		// Asked for, it loads as any other does.
		expect(rare.once(true)).toBeUndefined();
		await rare.whenLoaded();
		expect(rare.once(true)).toBe('viewer');
		expect(seldom).toHaveBeenCalledOnce();
	});
});
