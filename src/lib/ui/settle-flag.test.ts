import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINGER_MS, MIN_SHOWN_MS, SettleFlag, SHOW_AFTER_MS } from './settle-flag';

describe('SettleFlag', () => {
	let changes: boolean[];
	let flag: SettleFlag;

	beforeEach(() => {
		vi.useFakeTimers();
		changes = [];
		flag = new SettleFlag((on) => changes.push(on));
	});

	afterEach(() => {
		flag.dispose();
		vi.useRealTimers();
	});

	it('shows nothing for work quicker than the delay', () => {
		flag.set(true);
		vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
		flag.set(false);
		vi.advanceTimersByTime(5_000);
		expect(changes).toEqual([]);
	});

	it('turns on once the work has gone on for the delay, and off a moment after it ends', () => {
		flag.set(true);
		vi.advanceTimersByTime(SHOW_AFTER_MS);
		expect(changes).toEqual([true]);
		vi.advanceTimersByTime(MIN_SHOWN_MS + 100);
		flag.set(false);
		vi.advanceTimersByTime(LINGER_MS - 1);
		expect(changes).toEqual([true]);
		vi.advanceTimersByTime(1);
		expect(changes).toEqual([true, false]);
	});

	it('reads work in steps as one: a next step within the linger keeps it on', () => {
		flag.set(true);
		vi.advanceTimersByTime(SHOW_AFTER_MS + MIN_SHOWN_MS + 500);
		flag.set(false);
		vi.advanceTimersByTime(LINGER_MS - 50);
		flag.set(true);
		vi.advanceTimersByTime(2_000);
		expect(changes).toEqual([true]);
	});

	it('stays on for the minimum when the work ends just after it showed', () => {
		flag.set(true);
		vi.advanceTimersByTime(SHOW_AFTER_MS + 50);
		flag.set(false);
		vi.advanceTimersByTime(MIN_SHOWN_MS - 51);
		expect(changes).toEqual([true]);
		vi.advanceTimersByTime(1);
		expect(changes).toEqual([true, false]);
	});

	it('stays on, without blinking, when the work starts again while it waits to hide', () => {
		flag.set(true);
		vi.advanceTimersByTime(SHOW_AFTER_MS);
		flag.set(false);
		vi.advanceTimersByTime(100);
		flag.set(true);
		vi.advanceTimersByTime(5_000);
		expect(changes).toEqual([true]);
	});

	it('counts the delay from the latest start, and repeats of the same state change nothing', () => {
		flag.set(true);
		vi.advanceTimersByTime(SHOW_AFTER_MS - 100);
		flag.set(true);
		vi.advanceTimersByTime(100);
		expect(changes).toEqual([true]);
		flag.set(false);
		flag.set(false);
		vi.advanceTimersByTime(Math.max(MIN_SHOWN_MS, LINGER_MS));
		expect(changes).toEqual([true, false]);
	});
});
