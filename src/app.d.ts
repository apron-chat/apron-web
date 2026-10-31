// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** The `/__preview` page is built in (vite.config.ts): `vite dev`, or a build with `APRON_PREVIEW=1`. */
	const __APRON_PREVIEW__: boolean;
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		/** The room, and thread under it, a history entry returns to. */
		interface PageState {
			room?: string;
			thread?: string;
			/** The phone's rooms list is open over that room or thread: Back returns to it. */
			rooms?: true;
			/** Preferences is open, this many entries since it opened: closing it goes Back as many. */
			preferences?: number;
		}
		// interface Platform {}
	}
}

export {};
