import { startKeeping } from '$lib/history/startup';

/** As the app starts, before it loads the page: what is kept on this device for the next session begins to be read. */
export function init(): void {
	// Only for the page that signs in (`/`): `/__preview` and `/archive` keep nothing.
	if (window.location.pathname === '/') startKeeping();
}
