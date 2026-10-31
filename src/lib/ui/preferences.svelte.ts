import { formKeys } from './apron-link';

/**
 * Opening Preferences from anywhere on the page, at a section: the profile bar owns the dialog (`ProfileBar`), and
 * opens it when asked here, such as by Search's link to History.
 */
class PreferencesOpener {
	/** The section asked for, until the profile bar takes it. */
	asked = $state<{ section: string } | undefined>();

	open(section: string): void {
		this.asked = { section };
	}
}

export const preferencesOpener = new PreferencesOpener();

/** Preferences' sections, in the order its nav lists them (`PreferencesDialog`). */
export const PREFERENCE_SECTIONS = ['profile', 'notifications', 'appearance', 'media', 'history'] as const;

/**
 * The fragment key naming the open Preferences section, beside the page's place (`address.ts`), so a section
 * can be linked to and Back and Forward step through the sections opened:
 *
 * ```text
 * /#room=general&preferences=notifications
 * ```
 */
export const PREFERENCES_PARAM = 'preferences';

/** The Preferences section a URL's fragment opens, if it names one. */
export function readPreferences(hash: string): string | undefined {
	const section = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(PREFERENCES_PARAM);
	return (PREFERENCE_SECTIONS as readonly string[]).includes(section ?? '') ? section! : undefined;
}

/** The URL with Preferences open at `section`, or closed, keeping the rest of its fragment as it was. */
export function preferencesUrl(current: string, section: string | undefined): string {
	const url = new URL(current);
	const fragment = [...new URLSearchParams(url.hash.slice(1))].filter(([key]) => key !== PREFERENCES_PARAM);
	if (section) fragment.push([PREFERENCES_PARAM, section]);
	url.hash = formKeys(fragment);
	return url.toString();
}

/** Whether two URLs differ in nothing but the Preferences section they open. */
export function onlyPreferencesDiffer(a: string, b: string): boolean {
	try {
		return preferencesUrl(a, undefined) === preferencesUrl(b, undefined);
	} catch {
		return false;
	}
}
