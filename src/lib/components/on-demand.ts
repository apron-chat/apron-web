/*
 * What the page renders only on demand, in one chunk of its own apart from the page's: dialogs, the message
 * editor, and what only they or a click use. `lazy.ts` beside it loads it (see `Lazy`); nothing else imports these directly.
 */
export { default as MessageEditor } from './MessageEditor.svelte';
export { default as NewPrivateDialog } from './NewPrivateDialog.svelte';
export { default as NewRoomDialog } from './NewRoomDialog.svelte';
export { default as NewThreadDialog } from './NewThreadDialog.svelte';
export { default as PreferencesDialog } from './PreferencesDialog.svelte';
export { default as RoomEditor } from './RoomEditor.svelte';
export { default as SearchDialog } from './SearchDialog.svelte';
export { default as ShortcutsDialog } from './ShortcutsDialog.svelte';
export { default as SignInLinkDialog } from './SignInLinkDialog.svelte';
// Hosts that draw nothing until their state (eager) asks, rendered from then on (`Lazy.once`): the page's popovers.
export { default as ProfileCard } from './ProfileCard.svelte';
export { default as ReactorsPopover } from './ReactorsPopover.svelte';
export { default as ServerPane } from './ServerPane.svelte';
// What only a click or typing shows: the composer's autocomplete, the selection's bar, adding members, the install offer.
export { default as AddMembersDialog } from './AddMembersDialog.svelte';
export { default as AutocompletePicker } from './AutocompletePicker.svelte';
export { default as InstallPrompt } from './InstallPrompt.svelte';
export { default as SelectionBar } from './SelectionBar.svelte';
// Only Preferences' Profile section draws it (ProfileBar's `profileForm` snippet), and Preferences is in here too.
export { default as ProfileEditor } from '$lib/design/components/ProfileEditor.svelte';
// Preferences' Export.
export { exportArchive } from '$lib/archive/archive';
// Dragging a room in the sidebar (Sidebar's `reorderable`), which waits for this chunk rather than asking for it.
export { dndzone, DRAGGED_ELEMENT_ID, SHADOW_PLACEHOLDER_ITEM_ID, TRIGGERS } from 'svelte-dnd-action';
