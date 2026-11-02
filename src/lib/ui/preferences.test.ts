import { describe, expect, it } from 'vitest';
import { onlyPreferencesDiffer, preferencesUrl, readPreferences } from './preferences.svelte';

describe('Preferences in the address', () => {
	it('reads the section a fragment opens, only a known one', () => {
		expect(readPreferences('#room=general&preferences=notifications')).toBe('notifications');
		expect(readPreferences('preferences=media')).toBe('media');
		expect(readPreferences('#preferences=nope')).toBeUndefined();
		expect(readPreferences('#room=general')).toBeUndefined();
		expect(readPreferences('')).toBeUndefined();
	});

	it('writes and clears the section, keeping the rest of the fragment', () => {
		expect(preferencesUrl('https://apron.chat/#room=general', 'history')).toBe('https://apron.chat/#room=general&preferences=history');
		expect(preferencesUrl('https://apron.chat/#room=general&preferences=history', 'media')).toBe('https://apron.chat/#room=general&preferences=media');
		expect(preferencesUrl('https://apron.chat/#room=general&preferences=history', undefined)).toBe('https://apron.chat/#room=general');
		expect(preferencesUrl('https://apron.chat/?x=1#preferences=history', undefined)).toBe('https://apron.chat/?x=1');
		expect(preferencesUrl('https://apron.chat/', 'profile')).toBe('https://apron.chat/#preferences=profile');
	});

	it('tells a change of section from a move', () => {
		expect(onlyPreferencesDiffer('https://apron.chat/#room=a', 'https://apron.chat/#room=a&preferences=media')).toBe(true);
		expect(onlyPreferencesDiffer('https://apron.chat/#room=a&preferences=profile', 'https://apron.chat/#room=a&preferences=media')).toBe(true);
		expect(onlyPreferencesDiffer('https://apron.chat/#room=a', 'https://apron.chat/#room=b&preferences=media')).toBe(false);
	});
});
