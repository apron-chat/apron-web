import { Lazy } from '$lib/ui/lazy.svelte';

/** The on-demand chunk (`on-demand.ts`): the first component asked for loads them all, in one request. */
const onDemand = () => import('./on-demand');

export const messageEditor = new Lazy(() => onDemand().then((m) => m.MessageEditor));
export const newPrivateDialog = new Lazy(() => onDemand().then((m) => m.NewPrivateDialog));
export const newRoomDialog = new Lazy(() => onDemand().then((m) => m.NewRoomDialog));
export const newThreadDialog = new Lazy(() => onDemand().then((m) => m.NewThreadDialog));
export const preferencesDialog = new Lazy(() => onDemand().then((m) => m.PreferencesDialog));
export const roomEditor = new Lazy(() => onDemand().then((m) => m.RoomEditor));
export const searchDialog = new Lazy(() => onDemand().then((m) => m.SearchDialog));
export const signInLinkDialog = new Lazy(() => onDemand().then((m) => m.SignInLinkDialog));
export const profileEditor = new Lazy(() => onDemand().then((m) => m.ProfileEditor));
/** Not a component: `archiveExport.load()` gives `exportArchive`. */
export const archiveExport = new Lazy(() => onDemand().then((m) => m.exportArchive));
/** svelte-dnd-action, for dragging rooms: `roomDrag.whenLoaded()` waits for it without fetching it (Sidebar's `reorderable`). */
export const roomDrag = new Lazy(() => onDemand().then(({ dndzone, DRAGGED_ELEMENT_ID, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS }) => ({ dndzone, DRAGGED_ELEMENT_ID, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS })));
