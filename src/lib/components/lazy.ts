import { lazyChunk } from '$lib/ui/lazy.svelte';

/** The on-demand chunk (`on-demand.ts`): the first component asked for loads them all, in one request (`lazyChunk`). */
const part = lazyChunk(() => import('./on-demand'));

export const messageEditor = part((m) => m.MessageEditor);
export const newPrivateDialog = part((m) => m.NewPrivateDialog);
export const newRoomDialog = part((m) => m.NewRoomDialog);
export const newThreadDialog = part((m) => m.NewThreadDialog);
export const preferencesDialog = part((m) => m.PreferencesDialog);
export const roomEditor = part((m) => m.RoomEditor);
export const searchDialog = part((m) => m.SearchDialog);
export const shortcutsDialog = part((m) => m.ShortcutsDialog);
export const signInLinkDialog = part((m) => m.SignInLinkDialog);
export const profileEditor = part((m) => m.ProfileEditor);
export const addMembersDialog = part((m) => m.AddMembersDialog);
export const autocompletePicker = part((m) => m.AutocompletePicker);
export const installNudge = part((m) => m.InstallPrompt);
export const mentionAddNudge = part((m) => m.MentionAddPrompt);
export const editorsNudge = part((m) => m.EditorsPrompt);
export const selectionBar = part((m) => m.SelectionBar);
/**
 * Hosts that stay unmounted until their state first asks: render as `{#if host.once(Boolean(state.current))}`. The
 * layout's are in `overlays.ts`.
 */
export const profileCardHost = part((m) => m.ProfileCard);
export const reactorsPopover = part((m) => m.ReactorsPopover);
export const serverPaneHost = part((m) => m.ServerPane);
/** The composer's full panel: its formatting buttons and its Preview. */
export const formatToolbar = part((m) => m.FormatToolbar);
export const draftPreview = part((m) => m.DraftPreview);
/** Not a component: `archiveExport.load()` gives `exportArchive`. */
export const archiveExport = part((m) => m.exportArchive);
/** Not a component: `dragRooms`, for dragging rooms; `roomDrag.whenLoaded()` waits for it without fetching it (Sidebar's `reorderable`). */
export const roomDrag = part((m) => m.dragRooms);
