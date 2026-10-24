import { describe, expect, it } from 'vitest';
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
});
