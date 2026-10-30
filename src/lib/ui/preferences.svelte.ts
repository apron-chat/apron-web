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
