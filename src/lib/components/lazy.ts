import { Lazy } from '$lib/ui/lazy.svelte';

type OnDemand = typeof import('./on-demand');

/** Every part of the chunk below: once any of them has loaded it, they all have it. */
const parts: Lazy<unknown>[] = [];
let chunk: Promise<OnDemand> | undefined;

/**
 * The on-demand chunk (`on-demand.ts`): the first component asked for loads them all, in one request, and every part
 * is then here, so what waits on one without asking (`whenLoaded`) learns of it whichever part was asked for. A failed
 * load is forgotten, so the next ask fetches again.
 */
function onDemand(): Promise<OnDemand> {
	chunk ??= import('./on-demand').then(
		(loaded) => {
			for (const part of parts) part.load().catch(() => undefined);
			return loaded;
		},
		(error: unknown) => {
			chunk = undefined;
			throw error;
		}
	);
	return chunk;
}

function part<T>(pick: (loaded: OnDemand) => T): Lazy<T> {
	const lazy = new Lazy(() => onDemand().then(pick));
	parts.push(lazy);
	return lazy;
}

export const messageEditor = part((m) => m.MessageEditor);
export const newPrivateDialog = part((m) => m.NewPrivateDialog);
export const newRoomDialog = part((m) => m.NewRoomDialog);
export const newThreadDialog = part((m) => m.NewThreadDialog);
export const preferencesDialog = part((m) => m.PreferencesDialog);
export const roomEditor = part((m) => m.RoomEditor);
export const searchDialog = part((m) => m.SearchDialog);
export const signInLinkDialog = part((m) => m.SignInLinkDialog);
export const profileEditor = part((m) => m.ProfileEditor);
/** Not a component: `archiveExport.load()` gives `exportArchive`. */
export const archiveExport = part((m) => m.exportArchive);
/** svelte-dnd-action, for dragging rooms: `roomDrag.whenLoaded()` waits for it without fetching it (Sidebar's `reorderable`). */
export const roomDrag = part(({ dndzone, DRAGGED_ELEMENT_ID, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS }) => ({ dndzone, DRAGGED_ELEMENT_ID, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS }));
