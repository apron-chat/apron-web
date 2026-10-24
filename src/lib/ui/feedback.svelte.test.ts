import { describe, expect, it } from 'vitest';
import { RateLimitError } from '$lib/protocol/client';
import { FeedbackState } from './feedback.svelte';

describe('FeedbackState', () => {
	it('toasts an error, a wait on anything else with its wait, and leaves a wait on history or sending to the page', () => {
		const feedback = new FeedbackState();
		const failed = feedback.error(new Error('No such room'));
		expect(feedback.current).toEqual({ kind: 'error', text: 'No such room' });
		feedback.dismiss(failed);
		expect(feedback.current).toBeUndefined();
		feedback.error(new RateLimitError('Too Many Requests. Try again in 20s.', 'Too Many Requests', 1_000, 21_000));
		expect(feedback.current).toEqual({ kind: 'error', text: 'Too Many Requests. Try again in 20s.', wait: { message: 'Too Many Requests', since: 1_000, until: 21_000 } });
		// History and sending have their own notices: a pending toast goes, and nothing takes its place.
		feedback.pending('Uploading x.txt…');
		expect(feedback.error(new RateLimitError('Too Many Requests. Try again in 4h.', 'Too Many Requests', 0, 1, 'message'))).toBeUndefined();
		expect(feedback.current).toBeUndefined();
	});
});
