import { describe, expect, it } from 'vitest';
import { RateLimitError } from '$lib/protocol/client';
import { FeedbackState } from './feedback.svelte';

describe('FeedbackState', () => {
	it('toasts an error, a limit of no known scope with its wait, and leaves a scoped wait to the page', () => {
		const feedback = new FeedbackState();
		const failed = feedback.error(new Error('No such room'));
		expect(feedback.current).toEqual({ kind: 'error', text: 'No such room' });
		feedback.dismiss(failed);
		expect(feedback.current).toBeUndefined();
		feedback.error(new RateLimitError('Room listing limited. Try again in 20s.', 'Room listing limited', 1_000, 21_000));
		expect(feedback.current).toEqual({ kind: 'error', text: 'Room listing limited. Try again in 20s.', wait: { message: 'Room listing limited', since: 1_000, until: 21_000 } });
		// History, posting and uploads have their own notices: a pending toast goes, and nothing takes its place.
		feedback.pending('Uploading x.txt…');
		expect(feedback.error(new RateLimitError('Daily upload limit reached. Try again in 4h.', 'Daily upload limit reached', 0, 1, 'upload'))).toBeUndefined();
		expect(feedback.current).toBeUndefined();
	});
});
