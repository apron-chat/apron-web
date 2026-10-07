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

	it('stays quiet while silenced (paused or do not disturb), and doesn\'t alert for those mentions afterwards', () => {
		const presence = new PagePresence();
		presence.blur();
		presence.noteMentions(1, true, true);
		expect([presence.attention, presence.titleFlash]).toEqual([false, false]);
		expect(playPing).not.toHaveBeenCalled();
		// Silence ends with the same count: nothing new arrived since, so nothing alerts.
		presence.noteMentions(1, true, false);
		expect(presence.attention).toBe(false);
		// The next mention does.
		presence.noteMentions(2, true, false);
		expect(presence.attention).toBe(true);
		expect(playPing).toHaveBeenCalledTimes(1);
		presence.dispose();
	});
});
