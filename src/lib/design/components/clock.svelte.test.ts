import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tickingClock } from './clock.svelte';

describe('tickingClock', () => {
	afterEach(() => vi.useRealTimers());

	it('redoes what reads it at each tick, with one timer while anything does and none after', () => {
		vi.useFakeTimers();
		const now = tickingClock(1000);
		const seen: number[] = [];
		const stop = $effect.root(() => {
			$effect(() => void seen.push(now()));
			$effect(() => void now());
		});
		flushSync();
		expect(seen).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(999);
		flushSync();
		expect(seen).toHaveLength(1);
		vi.advanceTimersByTime(1);
		flushSync();
		expect(seen).toHaveLength(2);
		expect(seen[1] - seen[0]).toBe(1000);
		stop();
		flushSync();
		expect(vi.getTimerCount()).toBe(0);
	});
});
