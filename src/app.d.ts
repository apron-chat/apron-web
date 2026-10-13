// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
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
		}
		// interface Platform {}
	}
}

export {};
