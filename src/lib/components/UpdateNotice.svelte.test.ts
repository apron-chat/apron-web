// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from '$lib/test/dom';
import UpdateNotice from './UpdateNotice.svelte';

/** SvelteKit's `updated`: a newer deploy is out once `check` finds one (`version.json`). */
const deploy = vi.hoisted(() => ({ newer: false, checks: 0 }));
vi.mock('$app/state', async () => {
	const { SvelteSet } = await import('svelte/reactivity');
	const found = new SvelteSet<'newer'>();
	return {
		updated: {
			get current() {
				return found.has('newer');
			},
			async check() {
				deploy.checks += 1;
				if (deploy.newer) found.add('newer');
				return deploy.newer;
			}
		}
	};
});

const shown = () => document.body.textContent?.includes('Apron has been updated') ?? false;
const settle = async () => {
	for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
	flushSync();
};

describe('UpdateNotice', () => {
	it('offers a reload for a chunk that failed to load only once a newer deploy is found, not for a dropped connection', async () => {
		render(UpdateNotice);
		// Offline, or a server hiccup: the same deploy is still out.
		window.dispatchEvent(new Event('vite:preloadError'));
		await settle();
		expect(deploy.checks).toBe(1);
		expect(shown()).toBe(false);
		// A deploy removed the chunk.
		deploy.newer = true;
		window.dispatchEvent(new Event('vite:preloadError'));
		await settle();
		expect(shown()).toBe(true);
	});
});
