import { Lazy, lazyChunk } from '$lib/ui/lazy.svelte';

/** The on-demand chunk (`on-demand.ts`): the first component asked for loads them all, in one request (`lazyChunk`). */
const part = lazyChunk(() => import('./on-demand'));

export const messageEditor = part((m) => m.MessageEditor);
export const newPrivateDialog = part((m) => m.NewPrivateDialog);
export const newRoomDialog = part((m) => m.NewRoomDialog);
export const newThreadDialog = part((m) => m.NewThreadDialog);
export const roomEditor = part((m) => m.RoomEditor);
export const searchDialog = part((m) => m.SearchDialog);
export const shortcutsDialog = part((m) => m.ShortcutsDialog);
/** Every command the user can use (`ext:command_list`), opened by `/help` or the composer's Browse all commands. */
export const commandReference = part((m) => m.CommandReferenceDialog);
export const signInLinkDialog = part((m) => m.SignInLinkDialog);
/** Preferences, with Profile's form (ProfileBar's), which mounts the first time it opens. */
export const profilePreferences = part((m) => m.ProfilePreferences);
export const addMembersDialog = part((m) => m.AddMembersDialog);
export const autocompletePicker = part((m) => m.AutocompletePicker);
/** The entry of the command whose arguments are being typed, where the autocomplete sits (the design system's). */
export const commandCard = part((m) => m.CommandCard);
export const installNudge = part((m) => m.InstallPrompt);
export const mentionAddLine = part((m) => m.MentionAddLine);
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
/**
 * Not a component: `fileUpload.load()` gives `prepareUpload`, which readies a file attached to a draft. Readying one is
 * already a wait (a staged file says Preparing…, and Send waits for it), which this joins.
 */
export const fileUpload = part((m) => m.prepareUpload);
/** Not a component: `dragRooms`, for dragging rooms; `roomDrag.whenLoaded()` waits for it without fetching it (Sidebar's `reorderable`). */
export const roomDrag = part((m) => m.dragRooms);

/**
 * The document viewer (an uploaded Markdown file, rendered): seldom opened, so a chunk of its own, fetched when it first
 * opens and never in the background. Loaded by the page, not with the layout's overlays: it shares code highlighting
 * and history with the page, which the layout importing it would split out into a startup chunk of their own.
 */
export const docViewerHost = new Lazy(() => import('./DocViewerHost.svelte').then((m) => m.default), { prefetch: false });
