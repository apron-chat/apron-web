// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { FeedbackState } from '$lib/ui/feedback.svelte';
import { Lazy } from '$lib/ui/lazy.svelte';
import { render } from '$lib/test/dom';
import Toasts from './Toasts.svelte';

describe('Toasts', () => {
	it('says when code asked for didn’t load, which shows nothing by itself', async () => {
		const feedback = new FeedbackState();
		render(Toasts, { feedback, error: undefined, ondismisserror: () => undefined });
		const dialog = new Lazy<string>(async () => {
			throw new TypeError('Failed to fetch dynamically imported module');
		});
		void dialog.component;
		for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
		flushSync();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load that part of Apron. Check your connection, then try again.');
	});
});
