import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagePresence } from './presence.svelte';
import { playPing } from './attention';

vi.mock('./attention', () => ({ playPing: vi.fn() }));

describe('PagePresence', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.mocked(playPing).mockClear();
	});
	afterEach(() => vi.useRealTimers());

	it('flags the tab for a mention while away, until focus comes back', () => {
		const presence = new PagePresence();
		presence.noteMentions(1);
		expect(presence.attention).toBe(false);

		presence.blur();
		expect(presence.away).toBe(true);
		presence.noteMentions(1);
		expect(presence.attention).toBe(false);
		presence.noteMentions(2);
		expect([presence.attention, presence.titleFlash]).toEqual([true, true]);
		expect(playPing).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1000);
		expect(presence.titleFlash).toBe(false);

		presence.focus();
		expect([presence.attention, presence.titleFlash]).toEqual([false, false]);
		vi.advanceTimersByTime(3000);
		expect(presence.titleFlash).toBe(false);
		presence.dispose();
	});

	it('can suppress the chime when a desktop notification replaces it', () => {
		const presence = new PagePresence();
		presence.blur();
		presence.noteMentions(1, false);
		expect(presence.attention).toBe(true);
		expect(playPing).not.toHaveBeenCalled();
		presence.dispose();
	});
});
