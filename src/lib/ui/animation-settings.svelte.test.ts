import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '$lib/test/storage';
import { AnimationSettings, mayAnimate } from './animation-settings.svelte';

const values = new Map<string, string>();

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage(values));
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('animation settings', () => {
	it('plays unless the device asks for reduced motion, or as chosen whatever it asks; saves only a choice, and follows another tab', () => {
		const settings = new AnimationSettings();
		expect([settings.mode, settings.autoplay]).toEqual(['system', true]);
		settings.reducedMotion = true;
		expect(settings.autoplay).toBe(false);
		settings.set('always');
		expect([settings.autoplay, values.get('apron.animations')]).toEqual([true, 'always']);
		settings.set('never');
		settings.reducedMotion = false;
		expect(settings.autoplay).toBe(false);
		settings.set('system');
		expect(values.has('apron.animations')).toBe(false);
		settings.set('sometimes');
		expect(settings.mode).toBe('system');

		values.set('apron.animations', 'never');
		settings.storageChanged('apron.media');
		expect(settings.mode).toBe('system');
		settings.storageChanged('apron.animations');
		expect(settings.mode).toBe('never');
	});

	it('takes an image for animated by its type, else by its URL or file name', () => {
		expect(mayAnimate({ type: 'image/gif', url: 'https://chat.example/f/a' })).toBe(true);
		// A still thumbnail of a GIF is a still.
		expect(mayAnimate({ type: 'image/webp', url: 'https://chat.example/f/a.gif' }, 'a.gif')).toBe(false);
		expect(mayAnimate({ url: 'https://cdn.example/party.GIF?w=200' })).toBe(true);
		expect(mayAnimate({ url: 'https://chat.example/f/a' }, 'party.gif')).toBe(true);
		expect(mayAnimate({ url: 'https://chat.example/f/a.png' }, 'a.png')).toBe(false);
	});
});
