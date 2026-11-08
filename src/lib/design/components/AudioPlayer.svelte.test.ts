// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AudioPlayer, { clock } from './AudioPlayer.svelte';
import { waveOf } from './waveform';
import { button, render, unmount } from '$lib/test/dom';
import type { MediaSrc } from './types';

// Decoding needs a real browser: here a clip's wave is whatever the test says, and by default it can't be had.
vi.mock('./waveform', async (actual) => ({ ...(await actual<typeof import('./waveform')>()), waveOf: vi.fn(async () => undefined) }));

afterEach(() => {
	unmount();
	vi.mocked(waveOf).mockClear();
});

const src = 'blob:clip' as MediaSrc;

/** Has the browser report `duration` for the clip, as it does once it has read that far. */
function reports(audio: HTMLAudioElement, duration: number): void {
	Object.defineProperty(audio, 'duration', { configurable: true, get: () => duration });
	audio.dispatchEvent(new Event('durationchange'));
	flushSync();
}

describe('clock', () => {
	it('reads m:ss, and h:mm:ss past an hour', () => {
		expect([clock(0), clock(7.9), clock(47), clock(600), clock(3725)]).toEqual(['0:00', '0:07', '0:47', '10:00', '1:02:05']);
	});
});

describe('AudioPlayer', () => {
	it('draws its own controls, named for the clip, over a hidden audio element', () => {
		render(AudioPlayer, { src, preload: 'none', label: 'voice-message.webm' });
		const audio = document.querySelector('audio')!;
		expect([audio.controls, audio.getAttribute('preload'), audio.getAttribute('src')]).toEqual([false, 'none', 'blob:clip']);
		expect(button('Play voice-message.webm').title).toBe('Play');
		expect(document.querySelector('input[type=range]')?.getAttribute('aria-label')).toBe('Seek voice-message.webm');
	});

	it('shows the time played and the length once known, and seeks along it', () => {
		render(AudioPlayer, { src, label: 'clip' });
		const audio = document.querySelector('audio')!;
		const seek = document.querySelector<HTMLInputElement>('input[type=range]')!;
		// jsdom keeps no playhead: this one stays where it is put.
		let at = 0;
		Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => at, set: (value: number) => { at = value; } });
		reports(audio, 47);
		expect(document.querySelector('.ap-audio-time')?.textContent).toBe('0:00 / 0:47');
		expect([seek.disabled, seek.max]).toEqual([false, '47']);
		seek.value = '12';
		seek.dispatchEvent(new Event('input', { bubbles: true }));
		audio.dispatchEvent(new Event('timeupdate'));
		flushSync();
		expect(at).toBe(12);
		expect(document.querySelector('.ap-audio-time')?.textContent).toBe('0:12 / 0:47');
		expect(seek.getAttribute('aria-valuetext')).toBe('0:12 / 0:47');
	});

	it('shows only the time played, and holds the bar still, while the length is unknown (a recording made in the browser)', () => {
		render(AudioPlayer, { src, label: 'clip' });
		reports(document.querySelector('audio')!, Infinity);
		expect(document.querySelector('.ap-audio-time')?.textContent).toBe('0:00');
		expect(document.querySelector<HTMLInputElement>('input[type=range]')!.disabled).toBe(true);
	});

	it('steps the speed through 1×, 1.5× and 2×, then back', () => {
		render(AudioPlayer, { src, label: 'clip' });
		const audio = document.querySelector('audio')!;
		const seen: string[] = [];
		for (let i = 0; i < 4; i++) {
			const rate = document.querySelector<HTMLButtonElement>('.ap-audio-rate')!;
			seen.push(`${rate.textContent} ${audio.playbackRate}`);
			rate.click();
			flushSync();
		}
		expect(seen).toEqual(['1× 1', '1.5× 1.5', '2× 2', '1× 1']);
	});

	it('says Pause while playing, and starting one clip pauses another', () => {
		render(AudioPlayer, { src, label: 'first' });
		render(AudioPlayer, { src, label: 'second' });
		const [first, second] = document.querySelectorAll('audio');
		const pausedBy: string[] = [];
		for (const [audio, name] of [[first, 'first'], [second, 'second']] as const) {
			let paused = true;
			Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
			audio.play = async () => { paused = false; audio.dispatchEvent(new Event('play')); };
			audio.pause = () => { paused = true; pausedBy.push(name); audio.dispatchEvent(new Event('pause')); };
		}
		button('Play first').click();
		flushSync();
		expect(button('Pause first')).toBeTruthy();
		button('Play second').click();
		flushSync();
		expect(pausedBy).toEqual(['first']);
		expect([button('Play first'), button('Pause second')].every(Boolean)).toBe(true);
	});

	it('says it can\'t play a clip the browser can\'t, and disables its controls, until the clip changes', async () => {
		const player = render(AudioPlayer, { src, label: 'clip' });
		document.querySelector('audio')!.dispatchEvent(new Event('error'));
		flushSync();
		expect(document.querySelector('.ap-audio-time')?.textContent).toBe("Can't play");
		expect([...player.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')].map((control) => control.disabled)).toEqual([true, true, true]);
	});

	it('takes a refused Play as a clip that can\'t play, but not a Play cut short', async () => {
		render(AudioPlayer, { src, label: 'clip' });
		const audio = document.querySelector('audio')!;
		audio.play = () => Promise.reject(new DOMException('cut short', 'AbortError'));
		button('Play clip').click();
		await Promise.resolve();
		flushSync();
		expect(document.querySelector('.ap-audio-time')?.textContent).toBe('0:00');
		audio.play = () => Promise.reject(new DOMException('no source', 'NotSupportedError'));
		button('Play clip').click();
		await vi.waitFor(() => expect(document.querySelector('.ap-audio-time')?.textContent).toBe("Can't play"));
	});

	it('keeps the speed for the next clip it loads', () => {
		render(AudioPlayer, { src, label: 'clip' });
		document.querySelector<HTMLButtonElement>('.ap-audio-rate')!.click();
		flushSync();
		expect(document.querySelector('audio')!.defaultPlaybackRate).toBe(1.5);
	});

	it('draws a draft clip\'s waveform at once, and takes its length from decoding when the element has none', async () => {
		vi.mocked(waveOf).mockResolvedValueOnce({ peaks: [1, 0.5], duration: 9 });
		render(AudioPlayer, { src, preload: 'metadata', label: 'clip' });
		reports(document.querySelector('audio')!, Infinity);
		await vi.waitFor(() => expect(document.querySelectorAll('svg.ap-audio-wave path')).toHaveLength(2));
		expect(waveOf).toHaveBeenCalledWith('blob:clip', 160);
		expect(document.querySelector('.ap-audio-time')?.textContent).toBe('0:00 / 0:09');
		expect(document.querySelector<HTMLInputElement>('input[type=range]')!.disabled).toBe(false);
	});

	it('fetches nothing for a message\'s clip until it is played', async () => {
		vi.mocked(waveOf).mockResolvedValueOnce({ peaks: [1], duration: 3 });
		render(AudioPlayer, { src, preload: 'none', label: 'clip' });
		const audio = document.querySelector('audio')!;
		flushSync();
		expect(waveOf).not.toHaveBeenCalled();
		audio.dispatchEvent(new Event('play'));
		await vi.waitFor(() => expect(document.querySelector('svg.ap-audio-wave')).toBeTruthy());
		expect(waveOf).toHaveBeenCalledOnce();
	});

	it('keeps the plain bar for a clip over ten minutes', () => {
		render(AudioPlayer, { src, preload: 'none', label: 'clip' });
		const audio = document.querySelector('audio')!;
		reports(audio, 601);
		audio.dispatchEvent(new Event('play'));
		expect(waveOf).not.toHaveBeenCalled();
		reports(audio, 30);
		audio.dispatchEvent(new Event('play'));
		expect(waveOf).toHaveBeenCalledOnce();
	});
});
