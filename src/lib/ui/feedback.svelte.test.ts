import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError } from '$lib/protocol/client';
import { FeedbackState } from './feedback.svelte';

describe('FeedbackState', () => {
	it('toasts an error, a wait on anything else as one, and leaves a wait on history or messages to the page', () => {
		const feedback = new FeedbackState();
		const failed = feedback.error(new Error('No such room'));
		expect(feedback.current).toEqual({ kind: 'error', text: 'No such room' });
		feedback.dismiss(failed);
		expect(feedback.current).toBeUndefined();
		feedback.error(new RateLimitError('Too Many Requests. Try again in 20s.', 'Too Many Requests', 21_000));
		expect(feedback.current).toEqual({ kind: 'error', text: 'Too Many Requests. Try again in 20s.' });
		// History and sending have their own notices: a pending toast goes, and nothing takes its place.
		feedback.pending('Uploading x.txt…');
		expect(feedback.error(new RateLimitError('Too Many Requests. Try again in 4h.', 'Too Many Requests', 1, 'message', 'message'))).toBeUndefined();
		expect(feedback.current).toBeUndefined();
		// A reaction held back by a wait on posting has no notice of its own: it's toasted.
		feedback.error(new RateLimitError('Posting limit reached. Try again in 3m.', 'Posting limit reached', 180_000, 'write', 'reactions'));
		expect(feedback.current).toEqual({ kind: 'error', text: 'Posting limit reached. Try again in 3m.' });
	});

	describe('tracking a request', () => {
		afterEach(() => vi.useRealTimers());

		function handle(): { handle: { id: string; promise: Promise<Record<string, never>> }; resolve: () => void; reject: (cause: Error) => void } {
			let resolve!: () => void;
			let reject!: (cause: Error) => void;
			const promise = new Promise<Record<string, never>>((yes, no) => ((resolve = () => yes({})), (reject = no)));
			return { handle: { id: 'x', promise }, resolve, reject };
		}

		it('says a slow request is pending, and clears once it is done', async () => {
			vi.useFakeTimers();
			const feedback = new FeedbackState();
			const send = handle();
			feedback.track(send.handle, 'Sending…');
			expect(feedback.current).toBeUndefined();
			vi.advanceTimersByTime(600);
			expect(feedback.current).toEqual({ kind: 'pending', text: 'Sending…' });
			send.resolve();
			await send.handle.promise;
			await Promise.resolve();
			expect(feedback.current).toBeUndefined();
		});

		it('leaves a newer toast alone when an older request settles', async () => {
			vi.useFakeTimers();
			const feedback = new FeedbackState();
			const first = handle();
			const second = handle();
			feedback.track(first.handle, 'Sending…');
			feedback.track(second.handle, 'Saving edit…');
			first.resolve();
			await first.handle.promise;
			await Promise.resolve();
			// The second's pending toast still comes when it is slow.
			vi.advanceTimersByTime(600);
			expect(feedback.current).toEqual({ kind: 'pending', text: 'Saving edit…' });
			// Nor does a late failure of the first replace what shows now.
			const third = handle();
			let undone = false;
			feedback.track(third.handle, 'Joining…', () => (undone = true));
			feedback.pending('Uploading x.txt…');
			third.reject(new Error('No such room'));
			await third.handle.promise.catch(() => undefined);
			await Promise.resolve();
			expect(feedback.current).toEqual({ kind: 'pending', text: 'Uploading x.txt…' });
			// What it undoes on failure is undone all the same.
			expect(undone).toBe(true);
		});
	});
});
