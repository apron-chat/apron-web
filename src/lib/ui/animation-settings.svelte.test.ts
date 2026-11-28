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
	it('plays unless the device asks for reduced motion, or as chosen whatever it asks; saves only a choice', () => {
		const settings = new AnimationSettings();
		expect(settings.mode).toBe('system');
		expect(settings.autoplay).toBe(true);
		settings.reducedMotion = true;
		expect(settings.autoplay).toBe(false);
		settings.set('always');
		expect(settings.autoplay).toBe(true);
		expect(values.get('apron.animations')).toBe('always');
		settings.reducedMotion = false;
		settings.set('never');
		expect(settings.autoplay).toBe(false);
		const again = new AnimationSettings();
		again.load();
		expect(again.mode).toBe('never');
		settings.set('system');
		expect(values.has('apron.animations')).toBe(false);
		settings.set('sometimes');
		expect(settings.mode).toBe('system');
	});

	it('follows another tab', () => {
		const settings = new AnimationSettings();
		values.set('apron.animations', 'never');
		settings.storageChanged('apron.media');
		expect(settings.mode).toBe('system');
		settings.storageChanged('apron.animations');
		expect(settings.mode).toBe('never');
		values.set('apron.animations', 'nonsense');
		settings.storageChanged(null);
		expect(settings.mode).toBe('system');
	});

	it('takes an image for animated by its type, else by its URL or name', () => {
		expect(mayAnimate({ type: 'image/gif', url: 'https://chat.example/f/a' })).toBe(true);
		expect(mayAnimate({ type: 'IMAGE/APNG' })).toBe(true);
		// A still thumbnail of a GIF is a still.
		expect(mayAnimate({ type: 'image/webp', url: 'https://chat.example/f/a.gif' }, 'a.gif')).toBe(false);
		expect(mayAnimate({ url: 'https://cdn.example/party.GIF?w=200' })).toBe(true);
		expect(mayAnimate({ url: 'https://chat.example/f/a' }, 'party.gif')).toBe(true);
		expect(mayAnimate({ url: 'https://chat.example/f/a.png' }, 'a.png')).toBe(false);
		expect(mayAnimate({ url: 'not a url' })).toBe(false);
		expect(mayAnimate(undefined)).toBe(false);
	});
});
