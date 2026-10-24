/*
 * What the page renders only on demand, in one chunk of its own apart from the page's: dialogs and the message
 * editor. `lazy.ts` beside it loads it (see `Lazy`); nothing else imports these directly.
 */
export { default as MessageEditor } from './MessageEditor.svelte';
export { default as NewRoomDialog } from './NewRoomDialog.svelte';
export { default as NewThreadDialog } from './NewThreadDialog.svelte';
export { default as PreferencesDialog } from './PreferencesDialog.svelte';
export { default as RoomEditor } from './RoomEditor.svelte';
export { default as SignInLinkDialog } from './SignInLinkDialog.svelte';
