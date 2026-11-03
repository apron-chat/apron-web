import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressiveReveal } from './reveal.svelte';

describe('ProgressiveReveal', () => {
	let frames: FrameRequestCallback[];
	beforeEach(() => {
		vi.useFakeTimers();
		frames = [];
		vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
		vi.stubGlobal('cancelAnimationFrame', () => undefined);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	/** Paints a frame: what waits for it runs, then the timer after it. */
	const paint = async () => {
		for (const run of frames.splice(0)) run(0);
		await vi.runAllTimersAsync();
	};

	it('reveals the older items a chunk per paint', async () => {
		const reveal = new ProgressiveReveal(10, () => undefined, () => undefined);
		reveal.from(25);
		expect(reveal.hidden).toBe(25);
		await paint();
		expect(reveal.hidden).toBe(15);
		await paint();
		await paint();
		expect(reveal.hidden).toBe(0);
		expect(frames).toHaveLength(0);
	});

	it('more() reveals at once, before any paint, and the chunks go on from there', async () => {
		const reveal = new ProgressiveReveal(10, () => undefined, () => undefined);
		reveal.from(25);
		reveal.more(6);
		expect(reveal.hidden).toBe(19);
		await paint();
		expect(reveal.hidden).toBe(9);
	});

	it('more() past the oldest leaves nothing hidden and nothing to paint', async () => {
		const reveal = new ProgressiveReveal(10, () => undefined, () => undefined);
		reveal.from(4);
		reveal.more(6);
		expect(reveal.hidden).toBe(0);
		await paint();
		expect(reveal.hidden).toBe(0);
	});
});
