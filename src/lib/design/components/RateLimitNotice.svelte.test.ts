// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from './Composer.svelte';
import RateLimitNotice from './RateLimitNotice.svelte';
import RoomHeader from './RoomHeader.svelte';
import * as dom from '$lib/test/dom';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	dom.cleanup();
	vi.useRealTimers();
});

/** What the notice shows (its countdown included), and what a screen reader hears of it. */
function read(): { shown: string; heard: string } {
	const text = dom.byRole('status').querySelector('.ap-wait-text')!;
	const without = (selector: string) => [...text.childNodes].filter((node) => !(node instanceof Element && node.matches(selector))).map((node) => node.textContent).join('');
	return { shown: without('.ap-sr'), heard: without('.ap-wait-time') };
}

/** Lets the countdown tick for `ms`. */
function wait(ms: number): void {
	vi.advanceTimersByTime(ms);
	flushSync();
}

describe('RateLimitNotice', () => {
	it('says what the wait holds back and counts down to its end, the time a screen reader hears said once', () => {
		const now = Date.now();
		dom.render(RateLimitNotice, { scope: 'history', since: now, until: now + 17_000 });
		expect(read()).toEqual({ shown: 'Loading history is paused. Loading again in 17s', heard: 'Loading history is paused. Loading again in 17 seconds' });
		expect(dom.byRole('status').querySelector('.ap-wait-time')?.getAttribute('aria-hidden')).toBe('true');
		const ring = document.querySelector<SVGCircleElement>('.ap-wait-fill')!;
		const full = Number(ring.getAttribute('stroke-dasharray'));
		expect(Number(ring.getAttribute('stroke-dashoffset'))).toBe(0);
		wait(5_000);
		expect(read()).toEqual({ shown: 'Loading history is paused. Loading again in 12s', heard: 'Loading history is paused. Loading again in 17 seconds' });
		// The ring empties as the wait runs out.
		expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(full * 5 / 17);
	});

	it('counts from the wait’s end, not from when it rendered, so showing it again doesn’t start it over', () => {
		const now = Date.now();
		dom.render(RateLimitNotice, { scope: 'message', since: now - 30_000, until: now + 90_000 });
		expect(read().shown).toBe('Sending is paused. You can send again in 1:30.');
		expect(Number(document.querySelector('.ap-wait-fill')!.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 7 / 4);
	});

	it('shows a wait of an hour or more with a clock, in minutes, put away with its ×', () => {
		const now = Date.now();
		const ondismiss = vi.fn();
		dom.render(RateLimitNotice, { scope: 'message', since: now, until: now + (3 * 60 + 12) * 60_000, ondismiss });
		// The same words as a short wait: how long it is says nothing of why.
		expect(read()).toEqual({ shown: 'Sending is paused. You can send again in 3h 12m.', heard: 'Sending is paused. You can send again in 3 hours 12 minutes.' });
		expect(document.querySelector('.ap-wait-ring')).toBeNull();
		expect(document.querySelector('.ap-wait-clock')).not.toBeNull();
		dom.button('Dismiss').click();
		expect(ondismiss).toHaveBeenCalledOnce();
		dom.unmount();
		// History waits as long say so the same way; a short wait has no ×.
		dom.render(RateLimitNotice, { scope: 'history', since: now, until: now + 2 * 3_600_000, ondismiss });
		expect(read().shown).toBe('Loading history is paused. Loading again in 2h 0m');
		dom.unmount();
		dom.render(RateLimitNotice, { scope: 'message', until: now + 28_000, ondismiss });
		expect(dom.queryByRole('button', 'Dismiss')).toBeNull();
	});

	it('gives a wait on anything else in the server’s words, made a sentence, and says when it’s done', () => {
		const ondone = vi.fn();
		dom.render(RateLimitNotice, { message: 'Too Many Requests', until: Date.now() + 20_000, ondone });
		expect(read().shown).toBe('Too Many Requests. Try again in 20s');
		wait(19_999);
		expect(ondone).not.toHaveBeenCalled();
		wait(1);
		expect(ondone).toHaveBeenCalledOnce();
	});
});

describe('waiting elsewhere', () => {
	it('counts down on Send, which stays off with the draft kept, and comes back at zero', () => {
		const onsend = vi.fn();
		dom.render(Composer, { room: 'General', value: 'Sounds good, shipping it', onsend, waitUntil: Date.now() + 28_000 });
		const send = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
		expect([send.textContent, send.disabled, send.getAttribute('aria-label')]).toEqual(['28s', true, 'Send again in 28 seconds']);
		document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
		expect(onsend).not.toHaveBeenCalled();
		wait(28_000);
		expect([send.textContent, send.disabled]).toEqual(['Send', false]);
		document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
		expect(onsend).toHaveBeenCalledOnce();
	});

	it('keeps Send off with only files to send too', () => {
		const onsend = vi.fn();
		dom.render(Composer, { room: 'General', onsend, attachments: dom.html('<div class="ap-attachment">notes.pdf</div>'), waitUntil: Date.now() + 28_000 });
		const send = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
		expect([send.textContent, send.disabled]).toEqual(['28s', true]);
		document.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
		expect(onsend).not.toHaveBeenCalled();
		wait(28_000);
		expect([send.textContent, send.disabled]).toEqual(['Send', false]);
	});

	it('says the room is waiting in its header, counting down, in place of its note', () => {
		dom.render(RoomHeader, { room: 'general', name: 'General', note: 'History unavailable', wait: Date.now() + 18_000 });
		const note = document.querySelector('.ap-roomhead-wait')!;
		expect(note.textContent).toBe('Waiting · 18s');
		expect(document.querySelector('[role="status"]')).toBeNull();
		wait(1_000);
		expect(note.textContent).toBe('Waiting · 17s');
	});
});
