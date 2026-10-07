import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_AFTER_MS, PagePresence } from './presence.svelte';
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

	describe('idle (§4.5)', () => {
		const page = { visibilityState: 'visible' as DocumentVisibilityState, hasFocus: () => page.visibilityState === 'visible' };
		function setVisibility(state: DocumentVisibilityState): void {
			page.visibilityState = state;
		}
		beforeEach(() => {
			setVisibility('visible');
			vi.stubGlobal('document', page);
		});
		afterEach(() => vi.unstubAllGlobals());

		it('goes idle after IDLE_AFTER_MS without input, and any input ends it at once', () => {
			const presence = new PagePresence({ handheld: false });
			expect(presence.idle).toBe(false);
			// Loaded in view: attended from then.
			const loaded = Date.now();
			expect(presence.inputAt).toBe(loaded);
			vi.advanceTimersByTime(IDLE_AFTER_MS - 1);
			expect(presence.idle).toBe(false);
			// Input restarts the wait.
			presence.input();
			vi.advanceTimersByTime(IDLE_AFTER_MS - 1);
			expect(presence.idle).toBe(false);
			vi.advanceTimersByTime(1);
			expect(presence.idle).toBe(true);
			// When it was last used, for the idle report's seconds.
			expect(Date.now() - presence.inputAt!).toBe(IDLE_AFTER_MS);
			presence.input();
			expect(presence.idle).toBe(false);
			presence.dispose();
		});

		it('doesn\'t go idle on blur alone: a window on another monitor is still read', () => {
			const presence = new PagePresence({ handheld: false });
			presence.blur();
			expect(presence.away).toBe(true);
			vi.advanceTimersByTime(IDLE_AFTER_MS - 1_000);
			presence.input();
			vi.advanceTimersByTime(IDLE_AFTER_MS - 1_000);
			expect(presence.idle).toBe(false);
			// Coming back to the window counts as input.
			vi.advanceTimersByTime(1_000);
			expect(presence.idle).toBe(true);
			presence.focus();
			expect(presence.idle).toBe(false);
			presence.dispose();
		});

		it('takes a key or a press as focus, though the window\'s focus event never came', () => {
			const presence = new PagePresence({ handheld: false });
			presence.blur();
			presence.noteMentions(1);
			expect(presence.attention).toBe(true);
			// A pointer move over an unfocused window isn't focus.
			presence.input();
			expect(presence.focused).toBe(false);
			presence.input(true);
			expect([presence.focused, presence.away, presence.attention]).toEqual([true, false, false]);
			presence.dispose();
		});

		it('on a desktop, a hidden page waits like any other; on a handheld it is idle at once', () => {
			const desktop = new PagePresence({ handheld: false });
			const phone = new PagePresence({ handheld: true });
			setVisibility('hidden');
			desktop.visibilityChanged();
			phone.visibilityChanged();
			expect([desktop.idle, phone.idle]).toEqual([false, true]);
			vi.advanceTimersByTime(IDLE_AFTER_MS);
			expect(desktop.idle).toBe(true);
			// Shown again: someone is back.
			setVisibility('visible');
			desktop.visibilityChanged();
			phone.visibilityChanged();
			expect([desktop.idle, phone.idle]).toEqual([false, false]);
			desktop.dispose();
			phone.dispose();
		});

		it('starts idle when loaded hidden, until it is used', () => {
			setVisibility('hidden');
			const presence = new PagePresence({ handheld: false });
			expect(presence.idle).toBe(true);
			// Never used: how long it has gone unused isn't known.
			expect(presence.inputAt).toBeUndefined();
			presence.input(true);
			expect(presence.idle).toBe(false);
			expect(presence.inputAt).toBe(Date.now());
			presence.dispose();
		});
	});
});
