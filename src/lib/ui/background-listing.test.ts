import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError } from '$lib/protocol/client';
import { listInBackground } from './background-listing';

afterEach(() => {
	vi.useRealTimers();
});

const limited = (seconds: number) => new RateLimitError(`Too Many Requests. Try again in ${seconds}s.`, 'Too Many Requests', Date.now() + seconds * 1000);

describe('a background listing', () => {
	it('lists again once the wait it was refused for is over, and not for any other failure', async () => {
		vi.useFakeTimers();
		const answers = [() => Promise.reject(limited(20)), () => Promise.reject(new Error('Busy'))];
		const list = vi.fn(() => answers.shift()?.() ?? Promise.resolve());
		listInBackground(list);
		await vi.advanceTimersByTimeAsync(19_999);
		expect(list).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(list).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(list).toHaveBeenCalledTimes(2);
	});

	it('lists no more once stopped', async () => {
		vi.useFakeTimers();
		const list = vi.fn(() => Promise.reject(limited(5)));
		const stop = listInBackground(list);
		await vi.advanceTimersByTimeAsync(0);
		stop();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(list).toHaveBeenCalledTimes(1);
	});
});
