/*
 * What the page renders only on demand, in one chunk of its own apart from the page's: dialogs, the message
 * editor, and what only they or a click use. `lazy.ts` beside it loads it (see `Lazy`); nothing else imports these directly.
 */
export { default as MessageEditor } from './MessageEditor.svelte';
export { default as NewPrivateDialog } from './NewPrivateDialog.svelte';
export { default as NewRoomDialog } from './NewRoomDialog.svelte';
export { default as NewThreadDialog } from './NewThreadDialog.svelte';
// Preferences, which draws PreferencesDialog and, in its Profile section, the design system's ProfileEditor.
export { default as ProfilePreferences } from './ProfilePreferences.svelte';
export { default as DescriptionSheet } from './DescriptionSheet.svelte';
export { default as SearchDialog } from './SearchDialog.svelte';
export { default as ShortcutsDialog } from './ShortcutsDialog.svelte';
export { default as CommandReferenceDialog } from './CommandReferenceDialog.svelte';
export { default as SignInLinkDialog } from './SignInLinkDialog.svelte';
// Hosts that draw nothing until their state (eager) asks, rendered from then on (`Lazy.once`): the page's popovers.
export { default as ProfileCard } from './ProfileCard.svelte';
export { default as ReactorsPopover } from './ReactorsPopover.svelte';
export { default as ServerPane } from './ServerPane.svelte';
// What only a click or typing shows: the composer's autocomplete, the selection's bar, adding members, the install offer,
// the line offering to add who a message mentions, and the ask whether they may edit it.
export { default as AddMembersDialog } from './AddMembersDialog.svelte';
export { default as AutocompletePicker } from './AutocompletePicker.svelte';
export { default as CommandCard } from '$lib/design/components/CommandCard.svelte';
export { default as InstallPrompt } from './InstallPrompt.svelte';
export { default as MentionAddLine } from './MentionAddLine.svelte';
export { default as EditorsPrompt } from './EditorsPrompt.svelte';
export { default as SelectionBar } from './SelectionBar.svelte';
// The composer's full panel: its formatting buttons and keys, and its Preview.
export { default as FormatToolbar } from './FormatToolbar.svelte';
export { default as DraftPreview } from './DraftPreview.svelte';
// Readying a file attached to a draft for upload: an image shrunk and stripped of its metadata.
export { prepareUpload } from '$lib/ui/images';
// Dragging a room in the sidebar (Sidebar's `reorderable`), which waits for this chunk rather than asking for it.
export { dragRooms } from '$lib/ui/room-drag';
