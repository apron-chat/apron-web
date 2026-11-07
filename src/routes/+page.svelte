<script lang="ts">
	import { installNudge, mentionAddNudge, messageEditor, newPrivateDialog, newThreadDialog, profileCardHost, reactorsPopover, roomEditor, searchDialog, selectionBar, serverPaneHost, shortcutsDialog, signInLinkDialog } from '$lib/components/lazy';
	import { onMount, tick, untrack } from 'svelte';
	import { fromAction } from 'svelte/attachments';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { passkeySupportError } from '$lib/protocol/webauthn';
	import { ChatClient, UNSUPPORTED, defaultWebSocketUrl, editableTitle, findMessage, keepsBio, normalizeWebSocketUrl, serverArchive, serverLook, serverMedia, serverSettings, timelineMessages, webPushKey, yourPermissions, type ClientSnapshot, type EmbedEdits, type RoomSnapshot, type WebSocketFactory } from '$lib/protocol/client';
	import { embedsLabel, serverOrigin } from '$lib/protocol/embeds';
	import { withoutBidiOverrides } from '$lib/protocol/plain-text';
	import { compareLogIds } from '$lib/protocol/reducer';
	import { destinationUrl, elsewhereUrl, readDestination, type Destination } from '$lib/ui/address';
	import { readApronLink, writeApronLink, type ApronLink } from '$lib/ui/apron-link';
	import type { Embed, MessageRecord } from '$lib/protocol/types';
	import { isJsonObject, isSystemId } from '$lib/protocol/types';
	import { markdownRoles } from '$lib/protocol/markdown';
	import Composer from '$lib/components/Composer.svelte';
	import ReadOnlyBar from '$lib/components/ReadOnlyBar.svelte';
	import ConnectScreen from '$lib/components/ConnectScreen.svelte';
	import { SettleFlag } from '$lib/ui/settle-flag';
	import { onMac } from '$lib/ui/handheld';
	import { signedInScheme, type Scheme } from '$lib/ui/sign-in';
	import JumpBar from '$lib/components/JumpBar.svelte';
	import TimelineMessage from '$lib/components/TimelineMessage.svelte';
	import EmbedItem from '$lib/components/embeds/Embed.svelte';
	import type { Face, MessageEmbed, MessageHandlers, MessageTestids } from '$lib/design/components/types';
	import { linkedRoomIn, messageView, sourceEmbed, type LinkedRoom, type MessageCaps, type MessageContext, type MessageView } from '$lib/ui/message-view';
	import { decorateCode } from '$lib/ui/copy-code';
	import { emojiAnchor, emojiPicker, type EmojiPickerRequest } from '$lib/ui/emoji-picker.svelte';
	import { openProfileFrom, profileCard } from '$lib/ui/profile-card.svelte';
	import { reactorsList, showReactors } from '$lib/ui/reactors.svelte';
	import { serverPane } from '$lib/ui/server-pane.svelte';
	import RoomHeader from '$lib/components/RoomHeader.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SidebarHandle from '$lib/components/SidebarHandle.svelte';
	import MemberListSidebar from '$lib/components/MemberListSidebar.svelte';
	import NotifyPrompt from '$lib/components/NotifyPrompt.svelte';
	import { markFirstMessages } from '$lib/startup-marks';
	import { INSTALL_OFFER_AFTER_MS, installWay, installedAlready } from '$lib/ui/install';
	import StatusBanner from '$lib/design/components/StatusBanner.svelte';
	import ConnectionNotice from '$lib/components/ConnectionNotice.svelte';
	import NoRoom from '$lib/components/NoRoom.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import ThreadCard from '$lib/components/ThreadCard.svelte';
	import ThreadDescription from '$lib/components/ThreadDescription.svelte';
	import TimelineDivider from '$lib/design/components/TimelineDivider.svelte';
	import TypingIndicator from '$lib/design/components/TypingIndicator.svelte';
	import NoticeLine from '$lib/components/NoticeLine.svelte';
	import MembershipLine from '$lib/components/MembershipLine.svelte';
	import PrivateIntro from '$lib/design/components/PrivateIntro.svelte';
	import AddedBanner from '$lib/design/components/AddedBanner.svelte';
	import { ArrivalWatch, addRoomMembers, othersIn, reachesStart } from '$lib/ui/private-rooms';
	import { absentMentions, addMembers, couldNotAdd, isGuest, unheldRoleHolders } from '$lib/ui/members';
	import { faceOf, roomFaces } from '$lib/ui/faces';
	import { receiptsByMessage, steadyReceipts } from '$lib/ui/receipts';
	import { attachmentLimits, composerAction } from '$lib/ui/commands';
	import { serverLabel, statusLabel } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import { FeedbackState, type Feedback } from '$lib/ui/feedback.svelte';
	import type { LiveComposer } from '$lib/ui/live-composer.svelte';
	import { prepareUpload } from '$lib/ui/images';
	import { MentionTracker } from '$lib/ui/mentions.svelte';
	import { IncomingMessageTracker } from '$lib/ui/incoming-messages';
	import { UnreadTracker, countElsewhere, mutedMentions } from '$lib/ui/unread.svelte';
	import { ReadPositions } from '$lib/ui/read-positions';
	import { RoomOrder } from '$lib/ui/room-order.svelte';
	import { embedsOf, isOwn, mayMove, mentionsMe, peopleIn, messageSnippet, plainTextOf, senderName, textOf } from '$lib/ui/messages';
	import { removeEmbedQuestion } from '$lib/ui/attachments';
	import { messageLog, messageLogHtml } from '$lib/ui/message-log';
	import { reactionChips, type ReactionChip } from '$lib/ui/reactions';
	import { MessageSelection, type MoveAuthors } from '$lib/ui/selection.svelte';
	import { SessionView } from '$lib/ui/session.svelte';
	import { MEMBER_LIST_WIDTHS, ROOMS_LIST_WIDTHS, SidebarLayout } from '$lib/ui/sidebar.svelte';
	import { NARROW_MAX, WIDE_MIN } from '$lib/ui/breakpoints';
	import { loadDisplayName, loadMemberListPrefs, loadNotificationsEnabled, notificationsChosen, installOfferAnswered, answerInstallOffer, loadRecentServers, loadServerUrl, loadSidebarPrefs, refreshRecentServer, rememberServer, saveDisplayName, saveLastSignIn, saveMemberListPrefs, saveServerUrl, saveNotificationsEnabled, saveSidebarPrefs, loadNotifyScopes, saveNotifyScopes, NOTIFY_SCOPES_KEY, HIDDEN_DESCRIPTIONS_KEY, INSTALL_OFFER_KEY, loadAddedRooms, saveAddedRooms, loadHiddenDescriptions, hideDescription, showDescription, descriptionHidden, type RecentServer } from '$lib/ui/storage';
	import TimelineLoading from '$lib/design/components/TimelineLoading.svelte';
	import RateLimitNotice from '$lib/design/components/RateLimitNotice.svelte';
	import SystemLine from '$lib/design/components/SystemLine.svelte';
	import AppShell from '$lib/design/components/AppShell.svelte';
	import DropZone from '$lib/design/components/DropZone.svelte';
	import EmptyState from '$lib/design/components/EmptyState.svelte';
	import FloatingDayPill from '$lib/design/components/FloatingDay.svelte';
	import PanelToggle from '$lib/design/components/PanelToggle.svelte';
	import { ViewKeeper } from '$lib/ui/view-keeper';
	import type { HistoryKeeper } from '$lib/history/history-keeper';
	import { takeKeeper } from '$lib/history/startup';
	import { takeEarlyConnection } from '$lib/protocol/early-connection';
	import { startServer } from '$lib/ui/start-server';
	import { PREVIEW_SERVER } from '$lib/preview/preview-server';
	import { historySettings } from '$lib/history/settings.svelte';
	import { mediaAskClick } from '$lib/ui/media-ask';
	import { mediaSettings } from '$lib/ui/media-settings.svelte';
	import { receiptSettings } from '$lib/ui/receipt-settings.svelte';
	import { onlyPreferencesDiffer, preferencesOpener } from '$lib/ui/preferences.svelte';
	import { nextRoomRow } from '$lib/ui/room-steps';
	import { articleOf, isMessageRow, MESSAGE_STEPS, messageRows, rowControls, stepMessage, tabbableOutside, timelineItems } from '$lib/ui/message-focus';
	import { buildRoomTimeline, steady, threadEntries, threadStartedFrom, threadDescriptionFor, threadTitleFor, type ThreadEntry, type TimelineItem } from '$lib/ui/timeline';
	import { takeSignInLink } from '$lib/ui/sign-in-link';
	import { SignInLinks } from '$lib/ui/link-controller.svelte';
	import { findProposal } from '$lib/protocol/proposals';
	import { idMillis } from '$lib/ui/time';
	import { tabTitle } from '$lib/ui/attention';
	import { trackKeyboard } from '$lib/ui/viewport';
	import { linkPreviews } from '$lib/ui/link-previews';
	import { carriesFiles, fileDrop, pastedFiles } from '$lib/ui/file-transfer';
	import { PaneDrafts, pageDrafts, type StagedFile } from '$lib/ui/pane-drafts.svelte';
	import { PagePresence } from '$lib/ui/presence.svelte';
	import { JUMP_WAIT_MS, TimelineViewport, until } from '$lib/ui/timeline-viewport.svelte';
	import { setAppBadge, closeReadNotifications, messageNotificationTag, notificationBody, notificationClickTarget, notificationGroup, notificationTitle, notificationPermission, pushClickTarget, PUSH_ID_PARAM, PUSH_ID_QUERY, PUSH_MESSAGE_PARAM, PUSH_ROOM_PARAM, pushRoute, offersAtSignIn, offersNotifications, requestNotificationPermission, showNotification, type PushTarget, type NotificationPermissionState, type NotificationTarget, type NotificationTestResult } from '$lib/ui/notifications';
	import { playPing } from '$lib/ui/attention';
	import { isPaused, muteFor, type PausedUntil } from '$lib/ui/pause';
	import { pageSilenced } from '$lib/ui/user-status';
	import { PushSettings } from '$lib/ui/push-settings.svelte';
	import type { PushTitles } from '$lib/ui/push-titles';
	import { notifyAccount, notifyScopesOf, pushWake } from '$lib/ui/notify-scopes';
	import { arrivalAlerts } from '$lib/ui/alerts';
	import { readAction, readElsewhere, readFurthest } from '$lib/ui/read-action';
	import { createdRoom, createdThread, moveCheck, type PendingJoin, type PendingThread } from '$lib/ui/created';
	import { messageOf, Task } from '$lib/ui/task.svelte';
	import { accountServer, canOfferInstall, isStandalone, keepsPushOff, needsHomeScreen, offeredWake, webPushAccount, webPushSupported, type InstallPromptEvent } from '$lib/ui/web-push';

	/**
	 * A thread being started, named in the NewThreadDialog: under `room`, with
	 * what its form starts with. From the room's +, nothing else; from a
	 * message, `message`, which its first reply then answers; from select
	 * mode, `moving`, the selected messages that move into it.
	 */
	type NewThread = {
		room: { id: string; title: string; private?: true };
		title: string;
		description: string;
		message?: string;
		moving?: number;
	};

	/**
	 * How long a members listing stays current when the mention picker opens, in a pane read without joining it: a
	 * joined room's members came with its listing and stay current by memberships (§4.2.2), so it lists nothing.
	 */
	const MEMBERS_FRESH_MS = 15_000;
	/** How long the open room's messages wait for its thread listing, so the cards arrive with them. */
	const THREADS_WAIT_MS = 3000;
	/** The shortest gap between listings made because the pane has no members. */
	const MEMBERS_RETRY_MS = 10_000;

	const session = new SessionView();
	const feedback = new FeedbackState();
	/** The connection error closed from its toast; one that clears and comes back shows again. */
	let dismissedError = $state<string | undefined>();
	const mentions = new MentionTracker();
	/** How many mentions of you have arrived, muted rooms included: each new one can alert the tab. */
	let audibleMentions = $state(0);
	const incomingMessages = new IncomingMessageTracker();
	const unread = new UnreadTracker();
	/** How far you have read each room and thread, kept for the account (or this server's guests) on this device. */
	const readPositions = new ReadPositions(() => notifyKey);
	const presence = new PagePresence();
	const drafts = new PaneDrafts();
	// The update notice, in the layout, says when reloading would lose a draft.
	$effect(() => {
		pageDrafts.current = drafts;
		return () => {
			if (pageDrafts.current === drafts) pageDrafts.current = undefined;
		};
	});
	/** The timeline's scroll: following the latest, keeping your place, opening at the New divider (`TimelineViewport`). */
	const viewport = new TimelineViewport({
		get client() { return client; },
		get paneRoom() { return paneRoom; },
		get olderSource() { return olderSource; },
		get timeline() { return timeline; },
		get messages() { return messages; },
		get you() { return session.you; },
		get paneHeldBack() { return paneHeldBack; },
		get paneCatchingUp() { return paneCatchingUp; },
		get visible() { return presence.visible; },
		mentions,
		readThrough: (room) => readPositions.through(room, session.you, true)
	});
	/** Its scroll handler, handed to the list's `onscroll` as it is: through `viewport.` it would be wrapped, a call more per scroll event. */
	const trackScroll = viewport.trackScroll;
	/** Notifications on this device (one setting with push, below): this page's own, while it's open. */
	let notificationsEnabled = $state(false);
	/** Notifications were turned on or off on this device, or the first-mention offer answered: it isn't made again. */
	let notificationsChoiceMade = $state(true);
	/** The offer to turn notifications on (NotifyPrompt), at the first mention or at sign-in in an installed app, while it waits for an answer. */
	let notifyOffer = $state<{ from?: string; room?: string } | undefined>();
	let notificationState = $state<NotificationPermissionState>(notificationPermission());
	/** The server the client is on (`client.url`), kept as page state. */
	let serverUrl = $state('');
	/** Push per account (§4.9), and this browser's one subscription between them. */
	const pushSettings = new PushSettings({ setBadge: (unread) => void setAppBadge(navigator, unread) });
	/**
	 * The signed-in account (`webPushAccount`), not a guest: a guest's identity ends with its
	 * connection, so there is no one to push to. A reconnect keeps it.
	 */
	let pushAccount = $derived(session.you && (session.snapshot.passkeySession || session.snapshot.keptSession) ? webPushAccount(serverUrl, session.you.user_id) : undefined);
	/** The server's VAPID key, offered to a signed-in account. */
	let webPushServerKey = $derived(pushAccount ? webPushKey(session.server) : undefined);
	let webPushActive = $derived(pushSettings.isOn(pushAccount) && notificationState === 'granted');
	/**
	 * While push is on for the account, its rooms' titles are kept for the service worker, which names a pushed room by
	 * them. The code that keeps them loads the first time push is on, not with the app.
	 */
	let pushTitles: Promise<PushTitles> | undefined;
	$effect(() => {
		const pushId = webPushActive ? accountPushId : undefined;
		const rooms = pushId ? session.rooms : undefined;
		// Never on: nothing was kept to forget.
		if (!pushId && !pushTitles) return;
		pushTitles ??= import('$lib/ui/push-titles').then(({ PushTitles }) => new PushTitles());
		pushTitles.then((titles) => titles.keep(pushId, rooms)).catch(() => (pushTitles = undefined));
	});
	/**
	 * Notifications on this device, one setting: the page's own while Apron is open, and push
	 * for this account while it's closed. On if either is, so a choice made with the two
	 * switches before carries over; and only while still allowed, since the browser's
	 * permission can be revoked or reset behind the setting.
	 */
	let notificationsActive = $derived((notificationsEnabled || webPushActive) && notificationState === 'granted');
	/**
	 * The server keeps your read cursors (capability `activity`, §4.6, and no `read_cursors: false`), which carry what
	 * you read on other devices: only then do unread counts and mentions from before this page saw a room count, as
	 * otherwise what you read elsewhere would count again here.
	 */
	let syncsReads = $derived(Boolean(session.snapshot.capabilities.activity) && serverSettings(session.server).read_cursors);
	/**
	 * Push is on for this account, but the subscription is another account's, on
	 * a server with another key, that still has push on: that server's host. It
	 * moves here only when push is turned on here again, so two tabs don't take
	 * it back and forth.
	 */
	let webPushHeldBy = $derived.by(() => {
		const server = webPushActive ? pushSettings.heldBy(pushAccount, webPushServerKey) : undefined;
		return server === undefined ? undefined : serverLabel(server) || 'another server';
	});
	/** Bumped when a choice of what to notify about is saved, here or in another tab, so it is read again. */
	let notifyScopesSaved = $state(0);
	/** Who that choice is kept for: the signed-in account, or this server's guests. */
	let notifyKey = $derived(notifyAccount(serverUrl, pushAccount ? session.you?.user_id : undefined));
	/** What to notify about, for desktop notifications and push alike. */
	let notifyScopes = $derived.by(() => {
		void notifyScopesSaved;
		return notifyScopesOf(loadNotifyScopes(notifyKey));
	});
	/** The wake scopes the server pushes (§4.9), and the `wake` push sends: the checked ones of them. */
	let webPushOffered = $derived(offeredWake(session.server?.push));
	let webPushWake = $derived(pushWake(notifyScopes, webPushOffered));
	/** Why push doesn't work: the browser couldn't subscribe, or the server refused the registration. */
	let webPushError = $derived(pushSettings.error ?? session.snapshot.pushError);
	let webPushAvailable = $state(false);
	/** Apron runs as an installed app (`isStandalone`), as it loaded. */
	let runsInstalled = $state(false);
	/** Notifications are paused until then (§4.5 `mute`, as the server's `status` says). */
	let pausedUntil = $derived(session.snapshot.mutedUntil);
	/**
	 * This page stays quiet (no desktop notifications, chime or title flash):
	 * paused, or your status is `dnd`, which silences like a pause (§4.5).
	 */
	let silenced = $derived(pageSilenced(pausedUntil, session.you?.status));
	/** Pausing needs capability `status` and a signed-in account (a guest's `user_id` ends with its connection). */
	let canPause = $derived(session.server?.capabilities?.includes('status') === true && pushAccount !== undefined);
	/** Chromium's offer to install Apron, kept for the push setting's Install app button and the install offer. */
	let installPrompt = $state<InstallPromptEvent | undefined>();
	/** The offer to add Apron to the Home Screen (InstallPrompt) was answered on this device, or Apron was installed. */
	let installAnswered = $state(true);
	/** A phone's session has been up for INSTALL_OFFER_AFTER_MS: the install offer may be made. */
	let installOfferDue = $state(false);
	/** How this phone puts Apron on its Home Screen, while it's not running from there. */
	let installHow = $derived(runsInstalled ? undefined : installWay(Boolean(installPrompt)));
	/** Installed, Apron could alert this device while it's closed, as it can't before: an iPhone or iPad, signed in where push works. */
	let installAlerts = $derived(needsHomeScreen() && Boolean(webPushServerKey));
	/** The install offer, while it waits for an answer: one offer at a time, so not while notifications are offered. */
	let installOffer = $derived(installOfferDue && !installAnswered && !notifyOffer ? installHow : undefined);
	/** The account's `push_id` (§4.9): it names the account in pushed payloads and in message notifications. */
	let accountPushId = $derived(pushSettings.accountPushId);
	/** A pushed room to open once it is listed, if its `push_id` is this account's. */
	let pushRoom = $state<Pick<PushTarget, 'roomId' | 'pushId' | 'messageId'> | undefined>();
	/** A room, thread or message the page's URL named when it opened, to open once its server lists its rooms. */
	/** A destination to open: a link's, or a search result's (`searched`). */
	let linked = $state<(Destination & { server: string; room: string; searched?: boolean }) | undefined>();
	/**
	 * What a link's `room` was found to be, by server and room: the parent of a
	 * thread, `null` for a room that isn't one, or `undefined` while it is looked up.
	 */
	const linkedParents = new Map<string, string | null | undefined>();
	/** The connect screen is up for a link's server: it can be cancelled even before this server is ready. */
	let offeringLink = $state(false);
	/** How far back a linked message is looked for, in pages of history. */
	const LINKED_MESSAGE_PAGES = 20;
	/** How long a pushed room waits for its account and rooms before it is dropped. */
	const PUSH_ROOM_WAIT_MS = 30_000;
	/** Tells this tab's notifications apart from other tabs' when the service worker relays a click. */
	const tabId = Math.random().toString(36).slice(2);
	const selection = new MessageSelection();
	/** The rooms list's width and whether it's collapsed. */
	const sidebar = new SidebarLayout({ side: 'left', ...ROOMS_LIST_WIDTHS, load: loadSidebarPrefs, save: saveSidebarPrefs });
	/** The member list's width and, on wide screens, whether it's collapsed. */
	const memberList = new SidebarLayout({ side: 'right', ...MEMBER_LIST_WIDTHS, load: loadMemberListPrefs, save: saveMemberListPrefs });

	/** `/__preview` passes its in-memory server's sockets, and `/archive` those of the server reading an archive; every other visit connects for real. */
	let { webSocketFactory }: { webSocketFactory?: WebSocketFactory } = $props();
	/** Against the in-memory server: no backend to pick, and nothing remembered. */
	const previewMode = untrack(() => webSocketFactory !== undefined);

	let client = $state<ChatClient | undefined>();
	// Read Receipts on this device: off, your cursor in a private room isn't sent where the server would show it.
	$effect(() => client?.setReadReceipts(receiptSettings.on));
	let serverInput = $state('');
	let displayName = $state('');
	/** The `user_id`s the composer's chips mention (§3.5), sent as `body.mentions`. */
	let composerMentions = $state<string[]>([]);
	/**
	 * A message held back at Send because it mentions people who aren't in the room or thread it goes to: the ask to
	 * add them first (MentionAddPrompt), until it's answered, put away, the draft changes, or the pane does. `text` and
	 * `files` (the staged files' ids): the draft it asked about, which Add and send sends only if it is still that draft.
	 */
	let mentionAsk = $state<{ roomId: string; userIds: string[]; busy: boolean; text: string; files: string } | undefined>();
	let connectOpen = $state(false);
	/** Disconnected from the server pane: the connect screen can't be cancelled back to it. */
	let disconnected = $state(false);
	/** The sign-in scheme the connect screen opens with, when something asked for one. */
	let connectScheme = $state<Scheme | undefined>();
	/** The connect screen opens at choosing a server (a new one, or a link's), rather than at signing in to the one in it. */
	let connectChoosing = $state(false);
	let recentServers = $state<RecentServer[]>([]);
	let passkeyUnavailable = $state<string | undefined>();
	let highlightedId = $state<string | undefined>();
	let editingId = $state<string | undefined>();
	/** The Edit form for the open room or thread (its title and description). */
	let roomEditorOpen = $state(false);
	/** Search is open (`SearchDialog`), at its rooms and threads or at its messages. */
	let searchMode = $state<'rooms' | 'messages' | undefined>();
	/** The keyboard shortcuts' overlay (`?`) is open. */
	let shortcutsOpen = $state(false);
	/**
	 * Sign-in links (§4.11.2): one of no proposal this browser made waits for the viewer's answer (`asked`), one
	 * for an addition proposed here for its account's session (`addition`), and why one didn't sign in (`failure`).
	 */
	const links = new SignInLinks({
		client: () => client,
		feedback,
		findProposal: (state) => findProposal(state),
		// Another account from here on: the view held for the current one goes, and on this
		// server it is signed out of, push going off for it as a sign-out does.
		beforeSwitch: (switched) => (switched ? leaveBackend() : signedOut()()),
		signedIn: (server, switched) => {
			// Only now is a switch to the link's server remembered, and the server listed as recent.
			if (switched) {
				serverInput = server;
				saveServerUrl(server);
			}
			connected();
		},
		failed: ({ server, scheme }) => {
			// The connect screen can start again, on the link's server, which is not remembered unless that works.
			serverInput = server;
			connectScheme = scheme;
			connectChoosing = false;
			connectOpen = true;
		}
	});
	/** The open thread's `room_id`; undefined in the room view. */
	let activeThread = $state<string | undefined>();
	/** The toast for the last thread that failed to load, cleared once it no longer applies. */
	let threadError: Feedback | undefined;
	/** The end of a wait on sending whose notice was put away (a wait of hours can outlast the visit). */
	let dismissedSendWait = $state<number | undefined>();
	/** The same for a wait on uploads. */
	let dismissedUploadWait = $state<number | undefined>();
	let selectedRoomId = $state<string | undefined>();
	/** A thread this viewer created (`startThread`, `createThread`), opened once its `room_update` has arrived. */
	let pendingOpen = $state<PendingThread | undefined>();
	/** A room or thread joined from the directory or just created, opened once its `room_update` has arrived. */
	let pendingJoin = $state.raw<PendingJoin | undefined>();
	/** The NewThreadDialog, asking for a new thread's title and description, until it closes. */
	let newThread = $state<NewThread | undefined>();
	/** Threads this page started, by the message they were started from: Start thread again opens the same one. */
	const startedThreads = new Map<string, string>();
	let mobilePane = $state<'rooms' | 'main'>('main');
	/** Wide screens give the member list a column of its own; narrower ones overlay it on the conversation. */
	let memberListWide = $state(false);
	/** One pane at a time (under 720px). */
	let narrow = $state(false);
	/** The narrow overlay, closed until asked for. */
	let memberListOverlay = $state(false);
	/**
	 * The column is shown as last left (collapsed or not, and its width),
	 * remembered for the next visit; the overlay isn't.
	 */
	let memberListOpen = $derived(memberListWide ? !memberList.collapsed : memberListOverlay);
	/** The rooms list's column and the member list's, as the grid sizes them: 0 while shut. */
	let roomsTrack = $derived(sidebar.collapsed ? 0 : sidebar.width);
	let membersTrack = $derived(memberListWide && memberListOpen ? memberList.width : 0);
	/** Side panels slide only once the page is up, so the layout kept from the last visit doesn't animate in. */
	let slidesReady = $state(false);
	/** `narrow` and the panels' kept layout are read (on mount): until then nothing says which panels show. */
	let layoutKnown = $state(false);
	/**
	 * The open pane has drawn what it opened with (its messages, or that there are none) and that has painted: the
	 * panels out of sight wait for it to draw their rows (`sideDrawn`, `memberRowsDrawn`), so the first screen comes first.
	 */
	let firstScreenDrawn = $state(false);
	/** The rooms list shows: on a phone, as the pane in view; wider, unless shut. */
	let sideShown = $derived(layoutKnown && (narrow ? mobilePane === 'rooms' : !sidebar.collapsed));
	/**
	 * The rooms list draws its rooms once it shows, or once the first screen has drawn if it's hidden (behind a phone's
	 * conversation, or shut), and keeps them, hidden again (and where they were scrolled to): hidden, nobody can see,
	 * find or reach them meanwhile. Kept in a memo, not state. `firstScreenDrawn` is read first, so the derived always
	 * reads something: one that reads nothing is worked out again at every read.
	 */
	let sideKept = false;
	let sideDrawn = $derived(firstScreenDrawn || (sideKept ||= sideShown));
	/** The member list's rows, the same: from when it opens, or the first screen has drawn while it's shut. */
	let memberRowsKept = false;
	let memberRowsDrawn = $derived(firstScreenDrawn || (memberRowsKept ||= memberListOpen));
	let composer = $state<Composer | undefined>();
	/** The composer is the full panel, over the timeline: what arrives meanwhile isn't read (`readingLatest`). */
	let composerExpanded = $state(false);
	let memberListToggle = $state<PanelToggle | undefined>();
	/** The room your typing indicator shows in, and the timer that ends it there 5 s after the last keystroke. */
	let typingIn: { room: string; timer: ReturnType<typeof setTimeout> } | undefined;
	/** The last read whose notifications were closed (account, server, room, message), so each closes once. */
	let closedThrough: string | undefined;
	/**
	 * Per account's `push_id`: how far this page read each room itself, and how
	 * far a read elsewhere closed its notifications here (`readElsewhere`).
	 */
	const elsewhereReads = new Map<string, { own: Map<string, string>; closed: Map<string, string> }>();
	const elsewhereFor = (pushId: string) => {
		let reads = elsewhereReads.get(pushId);
		if (!reads) elsewhereReads.set(pushId, reads = { own: new Map(), closed: new Map() });
		return reads;
	};
	/** Numbers staged files, so each can be taken off its draft. */
	let stagedCount = 0;
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;

	let snapshot = $derived(session.snapshot);
	$effect(() => {
		if (!session.error) untrack(() => (dismissedError = undefined));
	});
	/** The top-level room open in the pane (or behind the open thread). */
	let activeRoom = $derived(session.activeRoom);
	/** The active room's threads: the joined ones, then those listed as not joined, which get cards too. */
	let threadSource = $derived(session.threadSource(activeRoom?.id));
	// Kept entry by entry while each says the same (`steady`), as the timeline's items are: not state, only what was last worked out.
	let lastThreads: ThreadEntry[] = [];
	let threads = $derived((lastThreads = steady(lastThreads, threadEntries(threadSource.rooms, activeRoom?.id, threadSource.directory))));
	let joinedThreads = $derived(threads.filter((entry) => entry.joined));
	/** The sidebar lists joined threads, and a thread open without joining while it is open. */
	let listedThreads = $derived(threads.filter((entry) => entry.joined || entry.id === activeThread));
	/** The open thread, joined or read without joining; the client holds either as a room. */
	let activeThreadEntry = $derived(activeThread && session.room(activeThread) ? threads.find((entry) => entry.id === activeThread) : undefined);
	let threadRoom = $derived(activeThreadEntry ? session.room(activeThreadEntry.id) : undefined);
	/** The room the pane shows and the composer posts to: the open thread (itself a room), else the room. */
	/**
	 * The rooms whose thread listing (`room_list` with their `parent_room_id`) has settled on this connection.
	 * Until the open room's has, its messages wait with it (a held copy, or placeholders), so the thread cards
	 * don't arrive on their own afterwards and shift the timeline. Once per room: switching back doesn't wait.
	 */
	let threadsListed = $state<readonly string[]>([]);
	let awaitingThreads = $derived(Boolean(session.ready && session.canManageRooms && session.activeRoomId && !threadsListed.includes(session.activeRoomId)));
	/** Who the rooms in `threadsListed` were listed for. */
	let threadsListedFor: string | undefined;
	// These two run before the page renders (`$effect.pre`), in this order: the listing goes out as soon as the room
	// is known, a round trip sooner than once the page has drawn the rooms that came with it.
	$effect.pre(() => {
		// The client keeps its thread listings through a dropped connection (`disconnectedAt`) and refreshes them
		// behind it, so a reconnect doesn't hold the room back again. A new session (a restart, signing out, another
		// account) starts over.
		const userId = session.snapshot.you?.user_id;
		if (!session.ready && session.snapshot.disconnectedAt === undefined) threadsListed = [];
		else if (userId !== undefined && userId !== threadsListedFor) {
			if (threadsListedFor !== undefined) threadsListed = [];
			threadsListedFor = userId;
		}
	});
	$effect.pre(() => {
		const roomId = session.ready && session.canManageRooms ? session.activeRoomId : undefined;
		if (!roomId || !client || untrack(() => threadsListed.includes(roomId))) return;
		let current = true;
		const settle = () => { if (current && !threadsListed.includes(roomId)) threadsListed = [...threadsListed, roomId]; };
		// The Sidebar asks for the same listing; the client shares one request.
		untrack(() => client!.listRooms(roomId)).then(settle, settle);
		// A slow listing holds the room back for this long at most.
		const cap = setTimeout(settle, THREADS_WAIT_MS);
		return () => { current = false; clearTimeout(cap); };
	});
	$effect(() => session.awaitThreads(awaitingThreads ? session.activeRoomId : undefined));

	/** The view kept on this device for the next visit: only for a session saved here (a passkey or email account). */
	const viewKeeper = new ViewKeeper({ enabled: !previewMode });
	/**
	 * The history kept on this device (`$lib/history`), for a session saved here: restored before the client
	 * connects, so a reload goes on as a reconnect does. None against an in-memory server.
	 */
	let historyKeeper = $state.raw<HistoryKeeper | undefined>();
	/** The retention the keeper was last told: Preferences changes it. */
	let keptRetention: string | undefined;
	$effect(() => {
		const retention = historySettings.retention;
		if (!historyKeeper || keptRetention === undefined || retention === keptRetention) return;
		keptRetention = retention;
		void historyKeeper.setRetention(historySettings.ms);
	});
	function keepView(): void {
		void viewKeeper.keep(client, untrack(() => session.keepable), untrack(() => session.snapshot.you));
	}
	$effect(() => {
		if (!session.keepable) return;
		const timer = setTimeout(keepView, viewKeeper.wait());
		return () => clearTimeout(timer);
	});
	/** The open thread as the pane shows it: its copy held from before (a reload) while the live one loads, as the room's. */
	let shownThreadRoom = $derived(session.heldCopy(threadRoom) ?? threadRoom);
	let paneRoom = $derived(activeThread ? shownThreadRoom : activeRoom);
	/** The live thread or room whose older pages load as the reader scrolls back: not a copy held from before. */
	let olderSource = $derived(activeThread ? threadRoom : session.activeRoomHeld ? undefined : session.room(session.activeRoomId));
	/** What's new in the rooms and threads other than the one being read, as the rooms list counts it: the phone header's back button shows it. */
	let unreadElsewhere = $derived(countElsewhere(unread.byRoom, paneRoom?.id));
	/** What the tab title and the app badge count: unread messages outside muted rooms, and mentions of you in them. */
	let unreadAlerting = $derived(unread.alerting + mutedMentions(unread.muted, mentions.byRoom));
	let mentionsElsewhere = $derived(countElsewhere(mentions.byRoom, paneRoom?.id));
	/** The waits the server asked for (`retry_after`) that are on, as the client holds them. */
	let limits = $derived(session.limits ?? {});
	/** The pane's history waits out a refused `history`, which every room's history shares: it waits, then loads by itself. */
	let historyWait = $derived(paneRoom?.limited ? limits.history : undefined);
	/**
	 * Sending waits out a refused `message`, with files or without, or a `write` wait (`ext:limits`), the longer if both
	 * are on: Send counts down, and the draft stays. A reaction, join or the like that a `write` wait holds back is toasted.
	 */
	let sendWait = $derived(limits.write && limits.write.until >= (limits.message?.until ?? 0) ? limits.write : limits.message);
	/** `sendWait`'s notice, unless it was put away. */
	let sendNotice = $derived(sendWait && sendWait.until !== dismissedSendWait ? sendWait : undefined);
	/** An `upload` wait (`ext:limits`) holds back only messages with files: Send counts down while files are attached, and text goes. */
	let uploadWait = $derived(limits.upload);
	/** `uploadWait`'s notice, unless it was put away. */
	let uploadNotice = $derived(uploadWait && uploadWait.until !== dismissedUploadWait ? uploadWait : undefined);
	/** Where Send counts down to: the wait that holds back this draft, the longer one if both do. */
	let composerWait = $derived(Math.max(sendWait?.until ?? 0, drafts.files.length ? (uploadWait?.until ?? 0) : 0) || undefined);
	/**
	 * The open pane is catching up: its history is recovering or loading, or it shows a copy held from before
	 * (a reconnect, or a reload) until the live one replaces it. The timeline says so at its foot.
	 */
	let paneCatchingUp = $derived(Boolean(paneRoom && (paneRoom.recovering || paneRoom.loading || historyWait || session.showingHeld || (activeThread ? shownThreadRoom !== threadRoom : session.activeRoomHeld || awaitingThreads))));
	/** `paneCatchingUp` or a quiet reconnect, as the floating pill shows it: only once it outlasts a moment, then for a moment at least. */
	let checkingShown = $state(false);
	const checking = new SettleFlag((on) => (checkingShown = on));
	/** A short drop of the connection, kept quiet: everything stays on screen while the socket comes back. */
	let quietReconnect = $derived(session.connection === 'reconnecting' && !session.reconnectNeedsAttention);
	// One pill for the whole way back: "Reconnecting…", then checking for what came meanwhile. None while a hidden
	// tab waits to reconnect, nor for the first moments once it tries, so a quick way back (as most are, coming back
	// to the tab) shows nothing.
	$effect(() => checking.set(!session.reconnectQuiet && !session.waitingToReconnect && (paneCatchingUp || quietReconnect)));
	$effect(() => () => checking.dispose());
	/**
	 * Other rooms are still catching up while this one is shown as it is: the room header's thin moving line
	 * (`updating`), not the pill, since nothing on screen is out of date; once the pill is gone, so the two don't
	 * show together. Not for rooms held by a history wait, whose recovery fetches nothing until it's over. Through a
	 * quiet reconnect's first moments, like the pill, nothing.
	 */
	let updatingShown = $state(false);
	const updating = new SettleFlag((on) => (updatingShown = on));
	$effect(() => updating.set(Boolean(paneRoom) && !paneCatchingUp && !checkingShown && !session.reconnectQuiet && !session.waitingToReconnect && session.rooms.some((room) => room.id !== paneRoom?.id && room.recovering && !room.limited)));
	$effect(() => () => updating.dispose());
	/** Older messages load above those shown, reading back: a pill at the top of the timeline says so. */
	let olderShown = $state(false);
	/** The room or thread whose older messages the pill is for: switched away from, it doesn't linger over the next. */
	let olderFor = $state<string | undefined>();
	const older = new SettleFlag((on) => {
		olderShown = on;
		olderFor = on ? olderSource?.id : undefined;
	});
	$effect(() => older.set(Boolean(olderSource?.loadingOlder)));
	let olderLoading = $derived(olderShown && olderFor !== undefined && olderFor === olderSource?.id);
	$effect(() => () => older.dispose());
	/** Nothing held to show while the room's threads are listed: placeholders, so its messages and thread cards appear together. */
	let paneHeldBack = $derived(awaitingThreads && !activeThread && !session.activeRoomHeld);
	let messages = $derived(timelineMessages(paneRoom));
	// Kept item by item while each says the same (`steady`), so a change elsewhere redraws no row: not state, only what was last worked out.
	let lastTimeline: TimelineItem[] = [];
	let timeline = $derived((lastTimeline = steady(lastTimeline, buildRoomTimeline({
		messages, threads: activeThread ? [] : threads, renames: paneRoom?.renames, notices: paneRoom?.notices, memberships: paneRoom?.timeline.memberships
	}))));
	const NO_RECEIPTS: ReadonlyMap<string, Face[]> = new Map();
	// The receipts last shown, which `steadyReceipts` keeps what is unchanged from; not state, only a memo.
	let lastReceipts: ReadonlyMap<string, Face[]> = NO_RECEIPTS;
	let shownTimeline = $derived(viewport.reveal.hidden > 0 ? timeline.slice(Math.min(viewport.reveal.hidden, timeline.length)) : timeline);
	// Before they render (once the pane shows items, not its placeholders, as the timeline below decides), a pane's first
	// messages render newest first.
	viewport.watchArrival();
	/**
	 * Read receipts (`ext.settings.read_receipts`, private rooms only): the other members' faces under the newest message
	 * shown that each has read through, by `message_id`. Empty, and the same map, wherever there are none.
	 */
	let receipts = $derived.by(() => {
		// Read Receipts turned off here: others' aren't shown either.
		const placed = receiptsByMessage(shownTimeline, paneRoom?.private && receiptSettings.on ? paneRoom : undefined, session.you?.user_id);
		const next = placed.size ? new Map([...placed].map(([messageId, people]) => [messageId, people.map((person) => faceOf(person, false))])) : NO_RECEIPTS;
		return (lastReceipts = steadyReceipts(lastReceipts, next));
	});
	/** The pane is live: its room is listed, and no sign-in is under way. */
	let paneReady = $derived(Boolean(paneRoom && session.ready && !session.authBusy));
	/** `paneReady`, or a quiet reconnect from it: what shows stays as it was, and what's asked waits for the connection. */
	let paneSteady = $derived(Boolean(paneRoom && session.steady && !session.authBusy));
	/** Writing here: posting, replying, reacting, and editing threads. A guest who only reads can't. */
	let canCompose = $derived(paneReady && !session.readOnly);
	/** Live typing (`/live`), loaded the first time it is used: see `startLive`. */
	let liveComposer = $state.raw<LiveComposer | undefined>();
	/** The same, read where typing reads it: not reactive, so that typing reads nothing of it until it loads. */
	let liveLoaded: LiveComposer | undefined;
	/** The open pane's draft is a live message. */
	let composingLive = $derived(liveComposer?.composing ?? false);
	/** Files dropped on the conversation or pasted outside the field attach to the draft while the composer is showing. */
	let canAttach = $derived(paneSteady && !session.readOnly && session.capabilities['embed:upload'] && !selection.active && !composingLive);
	/** Files are being dragged over the conversation. */
	let dropping = $state(false);
	/** Files dropped on the conversation pane's `<main>`. */
	const dropFiles = fromAction(fileDrop, () => ({ enabled: canAttach, onfiles: stageFiles, onactive: (active: boolean) => (dropping = active) }));
	let people = $derived(peopleIn([...(activeThread ? timelineMessages(activeRoom) : []), ...messages], session.you, paneRoom?.members));
	let roomSuggestions = $derived.by(() => {
		const rooms = new Map<string, { id: string; title: string }>();
		for (const room of [...(session.directory ?? []), ...Object.values(session.threadDirectory).flat(), ...session.rooms]) {
			rooms.set(room.id, { id: room.id, title: room.title });
		}
		return [...rooms.values()];
	});
	let typingNames = $derived(session.typing
		.filter((entry) => entry.room === paneRoom?.id && entry.from.user_id !== session.you?.user_id)
		.map((entry) => directory.name(entry.from)));
	// `server.agent` names the implementation, for debugging, not the server: its host and path are the label.
	/** What an archive's server says of it (`ext:archive`, ARCHIVE.md §4.1), while reading one. */
	let archive = $derived(serverArchive(session.server));
	let backendLabel = $derived(serverLabel(archive?.server ?? serverInput) || 'Apron');
	/** In place of the guest's read-only line, while reading an archive: whose it is, and from when. */
	let archiveNote = $derived.by(() => {
		if (!archive) return undefined;
		const saved = new Date(archive.exportedAt ?? '');
		const when = Number.isNaN(saved.getTime()) ? '' : `, saved ${saved.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
		return `An export from ${serverLabel(archive.server ?? '') || 'an Apron server'}${when}. It’s read-only.`;
	});
	/** How the connected server shows itself (§3.1): its title and avatar, never what it is known by (§1). */
	let currentLook = $derived(client && session.server ? serverLook(session.server, client.url) : {});
	// A recent server keeps how its latest `server` frame shows it, for the connect screen while it isn't connected.
	$effect(() => {
		const url = client?.url;
		const live = session.snapshot.server;
		if (previewMode || !url || !live) return;
		const look = serverLook(live, url);
		untrack(() => (recentServers = refreshRecentServer(recentServers, url, look)));
	});
	// A thread kept through a reconnect counts what it had while it catches up, rather than the count going and coming back.
	let threadReplyCount = $derived(threadRoom?.loaded || threadRoom?.resumed ? messages.length : undefined);
	/** The conversation shows: not behind the phone's rooms list, where only a faded sliver of it peeks out. */
	let paneShown = $derived(!(narrow && mobilePane === 'rooms'));
	/**
	 * You are reading the open pane's latest message: it shows, and the viewport says you are (`readingLatest`), and the
	 * composer's full panel isn't covering it.
	 */
	let readingLatest = $derived(paneShown && viewport.readingLatest && !composerExpanded);
	/** The pane's messages this viewer may pick, in order: what shift-click ranges run along. */
	let selectableOrder = $derived(messages.filter(canSelect).map((event) => event.message_id));
	/** Picked messages move with `message` requests (capability `edit`), which a reader who may not write makes none of. */
	let canMoveSelection = $derived(session.canEdit && !session.readOnly);
	let selectThreads = $derived(joinedThreads.filter((entry) => entry.id !== activeThread));
	/** New threads hang off a top-level room; this client keeps threads one level deep. */
	let canStartThreads = $derived(session.canManageRooms && !session.readOnly && Boolean(activeRoom) && activeRoom?.parentRoomId === undefined);
	/** Editing the open room's or thread's title and description (capability `rooms`); the server decides who may. */
	let canEditPane = $derived(session.canManageRooms && !session.readOnly && Boolean(activeThread ? activeThreadEntry : activeRoom));
	/** What the Edit form edits: the open thread, else the room; its title as written (`editableTitle`), so saving sends back every character. */
	let editTarget = $derived(activeThread
		? (activeThreadEntry ? { id: activeThreadEntry.id, title: editableTitle(session.room(activeThreadEntry.id) ?? activeThreadEntry), description: activeThreadEntry.description } : undefined)
		: (activeRoom ? { id: activeRoom.id, title: editableTitle(activeRoom), description: activeRoom.description } : undefined));
	/** Room and thread descriptions put away with their ×, on this device. */
	let hiddenDescriptions = $state(loadHiddenDescriptions());
	/** Whether the open room's or thread's description is put away: the header's Description brings it back. */
	let descriptionPutAway = $derived(Boolean(editTarget?.description && descriptionHidden(hiddenDescriptions, draftKey(editTarget.id), editTarget.description)));
	/** The open room's or thread's description, pinned under the header until its × puts it away (and again once it's edited). */
	let pinnedDescription = $derived(editTarget?.description && !descriptionPutAway ? { id: editTarget.id, description: editTarget.description } : undefined);
	/** Adding and removing other members of the open pane's room (§4.2.2), until the server says it can't. */
	let canChangeMembers = $derived(session.canManageRooms && !session.readOnly && paneSteady);
	/**
	 * Adding others to the open pane's room: anywhere with `add_members` (`ext:permissions`), or on a server without
	 * that extension, where the server answers `denied` if it won't; else only to a private room you are a member of
	 * (§4.2.4), whose members add people to it.
	 */
	let canAddMembers = $derived(canChangeMembers && (yourPermissions(session.server, session.you).add_members || Boolean(paneRoom?.private && paneRoom.joined)));
	/**
	 * Starting a private conversation (§4.2.4): the + beside Private and a profile card's Message, for an account
	 * signed in (not a guest) on a server that creates rooms (capability `rooms`).
	 */
	let canStartPrivate = $derived(session.canManageRooms && session.steady && !session.readOnly && session.passkeySession);
	/** The NewPrivateDialog, from the + beside Private. */
	let newPrivateOpen = $state(false);
	/** Notices the private rooms someone else added you to, as they arrive. */
	const arrivals = new ArrivalWatch();
	/** Whose added rooms, and the sidebar's folded rooms, are kept: each account on each server. */
	let addedAccount = $derived(notifyAccount(serverUrl, session.you?.user_id));
	/** The order of the sidebar's top-level rooms, kept on this device for the account. */
	const roomOrder = new RoomOrder();
	$effect(() => roomOrder.load(addedAccount));
	/** The private rooms someone else added you to whose "You were added" banner still shows, kept on this device. */
	let addedRooms = $state<string[]>([]);
	$effect(() => {
		addedRooms = loadAddedRooms(addedAccount);
	});
	// A room you're no longer in has no banner to show.
	$effect(() => {
		if (!snapshot.roomsListed) return;
		const joined = new Set(snapshot.rooms.filter((room) => room.joined).map((room) => room.id));
		untrack(() => {
			if (addedRooms.some((id) => !joined.has(id))) keepAdded(addedRooms.filter((id) => joined.has(id)));
		});
	});
	/** The open room is private, and someone else added you to it: its banner shows under the header. */
	let addedHere = $derived(Boolean(activeRoom && !activeThread && activeRoom.private && activeRoom.parentRoomId === undefined && addedRooms.includes(activeRoom.id)));
	/** Muting one room (§4.5 `mute` with its `room_id`) takes capability `status` and an account. */
	let canMuteRoom = $derived(Boolean(session.capabilities.status && session.passkeySession));
	/** Muting or unmuting from the banner, and why it didn't: the open room's, until another opens. */
	const addedTask = new Task<'saving', string>();
	$effect(() => {
		void activeRoom?.id;
		addedTask.reset();
	});
	/**
	 * The start of the open private room, once its history reaches back to it (`reachesStart`) and all of it is on
	 * screen: who it's with, and what private means, at the head of the timeline.
	 */
	let privateIntro = $derived.by(() => {
		const room = activeThread ? undefined : activeRoom;
		if (!room?.private || room.parentRoomId !== undefined || !reachesStart(room) || viewport.reveal.hidden > 0) return undefined;
		const others = othersIn(room, session.you?.user_id);
		const one = room.namedForMembers && others.length === 1 ? directory.person(others[0]) : undefined;
		const bio = one && keepsBio(session.server) ? directory.bio(one)?.split('\n')[0] : undefined;
		const count = Math.max(room.memberCount ?? 0, room.members?.length ?? 0);
		const detail = one ? `@${one.user_id}${bio ? ` · ${bio}` : ''}` : count ? `${count} ${count === 1 ? 'member' : 'members'}` : undefined;
		return { name: room.title, faces: roomFaces(room, session.you), detail };
	});

	$effect(() => {
		const roomId = activeRoom?.id;
		if (roomId !== undefined && selectedRoomId !== roomId) setDestination(roomId, undefined);
	});

	// Back and Forward move between the destinations setDestination recorded, and in and out of the phone's rooms list.
	$effect(() => {
		const { room, thread, rooms } = page.state;
		untrack(() => {
			if (room !== undefined) revisit(room, thread);
			mobilePane = rooms ? 'rooms' : 'main';
		});
	});

	// What arrives alerts: mentions you'd hear chime and flash the tab, the first offers notifications (until
	// they're chosen on this device), and while you're away they notify. Never from a held view (`arrivalAlerts`).
	$effect(() => {
		const alerts = arrivalAlerts(
			{ held: session.showingHeld, rooms: session.rooms, you: session.you, pane: paneRoom?.id, latestVisible: viewport.latestVisible && paneShown, readThrough: syncsReads ? (room) => readPositions.through(room, session.you) : () => undefined },
			{ mentions, messages: incomingMessages },
			{
				offerable: untrack(() => !notifyOffer && !installOffer && offersNotifications({ chosen: notificationsChoiceMade, active: notificationsActive, permission: notificationState, silenced })),
				active: notificationsActive, away: presence.away, silenced, scopes: notifyScopes
			}
		);
		untrack(() => {
			if (alerts.audible) audibleMentions += alerts.audible;
			if (alerts.offer) notifyOffer = alerts.offer;
			for (const { event, mention } of alerts.notify) void notifyMessage(event, mention);
		});
	});

	// Your read cursors as the server reports them, and your own newest messages, move your read positions.
	$effect(() => {
		if (session.showingHeld) return;
		readPositions.observe(session.rooms, session.you);
	});

	$effect(() => {
		if (session.showingHeld) return;
		const me = session.you;
		unread.observe(session.rooms, me, paneRoom?.id, readingLatest && presence.visible, (room) => readPositions.through(room, me), syncsReads);
	});

	// On a phone, a while after the session is up, offer to add Apron to the Home Screen: once, until answered. Not
	// while reading an archive, whose answer wouldn't be kept, nor where Chrome says Apron is installed already.
	$effect(() => {
		if (!session.ready || archive || installOfferDue || untrack(() => installAnswered || !installHow)) return;
		let current = true;
		const due = setTimeout(() => {
			void installedAlready().then((installed) => {
				if (!current) return;
				if (installed) installAnswered = true;
				else installOfferDue = true;
			});
		}, INSTALL_OFFER_AFTER_MS);
		return () => {
			current = false;
			clearTimeout(due);
		};
	});

	// Signed in to an installed app where push works: offer notifications now, not at the first mention.
	$effect(() => {
		if (!session.ready || notifyOffer || previewMode) return;
		if (offersAtSignIn({ installed: runsInstalled, push: webPushAvailable && Boolean(webPushServerKey), chosen: notificationsChoiceMade, active: notificationsActive, permission: notificationState, silenced })) notifyOffer = {};
	});

	// The account's `push_id`, made and kept in storage the first time: here, not in a derivation.
	$effect(() => {
		const account = pushAccount;
		untrack(() => pushSettings.follow(account));
	});

	// While push is on for this account (§4.9), keep this browser subscribed with the server's
	// key, which the client registers on each connection.
	$effect(() => {
		const chat = client;
		const key = webPushServerKey;
		const userId = session.you?.user_id;
		const wake = webPushWake;
		if (!chat || !key || !userId || !webPushActive || webPushHeldBy || !session.ready) return;
		// A new choice of scopes registers again at once: the same `url`, new params.
		untrack(() => void pushSettings.enable(chat, key, userId, wake, () => session.you?.user_id === userId && webPushActive));
	});

	// Turned off, here or in another tab, or for another account now, or the subscription moved to
	// another server: this one isn't registered, and the browser's endpoint is unregistered after
	// each `auth`, in case an earlier unregister was missed. Not before the account is known: a
	// page load would unregister, then register again once signed in.
	$effect(() => {
		const chat = client;
		if (!chat || previewMode || !keepsPushOff(pushAccount, webPushActive, webPushHeldBy)) return;
		untrack(() => void pushSettings.keepOff(chat));
	});

	// While Apron is in view, the app badge shows its own unread count (in muted rooms, only mentions); away, pushes' `unread` sets it.
	$effect(() => {
		const total = unreadAlerting;
		if (presence.visible && !previewMode) untrack(() => void setAppBadge(navigator, total));
	});

	// A pushed room still waiting after a while (its account never came, its rooms never listed) goes.
	$effect(() => {
		const pending = pushRoom;
		if (!pending) return;
		const timer = setTimeout(() => {
			if (pushRoom === pending) pushRoom = undefined;
		}, PUSH_ROOM_WAIT_MS);
		return () => clearTimeout(timer);
	});

	// A pushed room opens once it is listed, a thread under its room, if it was pushed for this
	// account; once the rooms are listed without it, it goes.
	$effect(() => {
		const pending = pushRoom;
		if (!pending) return;
		const route = pushRoute(pending, accountPushId);
		if (route === 'wait') return;
		if (route === 'ignore') {
			pushRoom = undefined;
			return;
		}
		if (!session.ready) return;
		const room = session.rooms.find((candidate) => candidate.id === pending.roomId);
		if (!room) {
			if (session.snapshot.roomsListed) pushRoom = undefined;
			return;
		}
		pushRoom = undefined;
		untrack(() => openAtMessage(room.parentRoomId ?? room.id, room.parentRoomId ? room.id : undefined, pending.messageId));
	});

	// A linked destination waits a while for its server's rooms, then goes.
	$effect(() => {
		const pending = linked;
		if (!pending || serverUrl !== pending.server) return;
		const timer = setTimeout(() => {
			if (linked === pending) abandonLink(activeRoom?.id !== pending.room ? 'room' : 'thread');
		}, PUSH_ROOM_WAIT_MS);
		return () => clearTimeout(timer);
	});

	// A linked destination opens once its server's rooms are listed, step by step as each listing arrives; one on
	// a server offered on the connect screen waits there, and goes if the viewer stays where they are.
	$effect(() => {
		const pending = linked;
		if (!pending || !serverUrl) return;
		if (serverUrl !== pending.server) {
			if (!connectOpen) linked = undefined;
			return;
		}
		if (!session.ready || !session.snapshot.roomsListed) return;
		void [session.rooms, session.directory, session.threadDirectory[pending.room], activeRoom?.id, activeThread];
		untrack(() => openLinked(pending));
	});

	// Nobody has used this page for a while (§4.5 `idle`): the server may push instead.
	// The client keeps it across connections and reports it on each.
	$effect(() => {
		const idle = presence.idle;
		if (client) untrack(() => client?.setIdle(idle, presence.inputAt));
	});

	$effect(() => {
		const arrived = audibleMentions;
		// Paused (§4.5 `mute`) or do not disturb: no client notifications, so no chime or title flash
		// either, and the mentions that arrive meanwhile don't alert once it ends.
		const quiet = silenced;
		// A notification chimes instead; `notifyMessage` chimes if it couldn't show one.
		const playSound = !notificationsActive;
		untrack(() => presence.noteMentions(arrived, playSound, quiet));
	});

	// The New divider is placed once per visit, from your read position, and the pane opens at it.
	viewport.watchDivider();

	// Back in view, the latest row is measured again, before reading it marks anything read: before the read below, in this order.
	viewport.watchReturn();

	// Reading the latest message advances your read position, and your read cursor (capability `activity`),
	// which the server syncs to your other devices.
	// Only from a live, visible, loaded pane at its latest message, once it has opened at its divider (`readAction`).
	// Before the page draws (`$effect.pre`): a message that arrives while you read the latest is marked read, and the
	// client's snapshot of that comes, before the timeline and sidebar work out the message's own. They then work out
	// the two together once, where after drawing each row and room was worked out again for the read.
	$effect.pre(() => {
		const action = readAction(
			{ server: client?.url, room: paneRoom, last: messages[messages.length - 1]?.message_id, ready: session.ready, readingLatest, visible: presence.visible, away: presence.away },
			untrack(() => ({ pushId: accountPushId, closedThrough }))
		);
		if (!action) return;
		untrack(() => {
			// Kept before the cursor moves: it is what this page read, not a read elsewhere.
			if (accountPushId) readFurthest(elsewhereFor(accountPushId).own, action.room, action.message);
			readPositions.read(action.room, action.message);
			client?.markRead(action.room, action.message);
			// What you just read here no longer needs its notifications on this device.
			if (!action.close) return;
			closedThrough = action.close.key;
			void closeReadNotifications(action.close.target, action.message);
		});
	});

	// A room read on another device closes its notifications here too, up to where you read it, once this page
	// learns of it: at once while it is open, else as it lists your rooms again (`readElsewhere`). Pushed ones only:
	// they are what stays on a device, and on Android what the app icon's badge counts.
	$effect(() => {
		const pushId = accountPushId;
		const rooms = session.snapshot.rooms;
		if (!pushId || previewMode || !session.ready) return;
		untrack(() => {
			const reads = elsewhereFor(pushId);
			for (const { room, message } of readElsewhere(rooms, reads.own, reads.closed)) {
				reads.closed.set(room, message);
				void closeReadNotifications({ group: notificationGroup(pushId, room) }, message);
			}
		});
	});

	// Members for the mention picker come with each joined room's listing and stay current by
	// memberships (§4.2.2); a pane without them (a thread read without joining) lists its room
	// with `room_list` and `room_id` (capability `rooms`).
	$effect(() => {
		const room = paneRoom;
		if (!client || !room || !session.ready || !session.canManageRooms || room.members !== undefined) return;
		untrack(() => listMembers(MEMBERS_RETRY_MS));
	});

	// A room joined from the directory, or created from the sidebar, opens once its `room_update` has arrived.
	$effect(() => {
		const joined = pendingJoin;
		const room = joined ? session.rooms.find((candidate) => candidate.id === joined.room) : undefined;
		if (!joined || !room) return;
		pendingJoin = undefined;
		// A server that doesn't keep private rooms may create an ordinary one anyway: say so, and don't open it to post in.
		const step = createdRoom(room, joined.private);
		if ('refuse' in step) {
			untrack(() => feedback.error(step.refuse));
			return;
		}
		untrack(() => {
			if (room.parentRoomId !== undefined && session.rooms.some((candidate) => candidate.id === room.parentRoomId)) openDestination(room.parentRoomId, room.id);
			else chooseRoom(room);
		});
	});

	// A server without guests (and no kept session to resume) can only be used signed in, and so can a
	// session held until its user signs in again with nothing on screen yet: the connect screen, with the
	// server's welcome (§3.2), opens once by itself, rather than leaving an empty app and an error.
	// Not while a sign-in link waits for its answer or is being used: that is a sign-in already.
	let promptedSignIn = false;
	$effect(() => {
		const server = snapshot.server;
		if (previewMode || promptedSignIn || connectOpen || links.asked || links.busy || links.addition || snapshot.authBusy || !server || snapshot.authenticated || snapshot.status !== 'connected') return;
		const needed = snapshot.signInNeeded && session.rooms.length === 0 ? snapshot.signInNeeded : undefined;
		if (!needed && (server.auth.includes('guest') || server.signup?.includes('guest') || !snapshot.error)) return;
		promptedSignIn = true;
		untrack(() => openConnect(needed ? { scheme: needed } : { signIn: true }));
	});

	/** The banner's Sign in for a held session: the sign-in screen where it needs one, else a reconnect. */
	function signInAgain(): void {
		if (!client) return;
		if (snapshot.signInNeeded) openConnect({ scheme: snapshot.signInNeeded });
		else session.retryNow(client);
	}

	// Leaving a pane ends its selection in setDestination; losing the capability ends it here.
	$effect(() => {
		if (!session.canEdit) selection.leave();
	});

	// A thread this viewer just created opens once its `room_update` has arrived.
	$effect(() => {
		const pending = pendingOpen;
		if (!pending) return;
		const step = createdThread(pending, session.rooms);
		if (step === 'wait') return;
		pendingOpen = undefined;
		// A thread of a private room is private too (§4.2.4); one the server made visible isn't opened to reply in.
		if (step !== 'open') {
			untrack(() => feedback.error(step.refuse));
			return;
		}
		untrack(() => {
			openDestination(pending.room, pending.thread);
			if (pending.replyTo !== undefined && !drafts.reply) drafts.setReply(pending.replyTo);
		});
	});

	// A thread's or a room's first page may not fill the pane: older pages load until it does.
	viewport.watchFill();

	// Threads don't recover with their parent, nor does a room read without joining it: the open one loads its own
	// history, again after a reconnect, which lists it afresh.
	$effect(() => {
		const room = activeThread ? threadRoom : olderSource?.joined === false ? olderSource : undefined;
		// A held copy (from before a reconnect or a reload) isn't the live thread: that one loads once it's listed.
		if (!client || !room || !session.ready || session.showingHeld || room.loaded || room.loading || room.recoveryError) return;
		untrack(() => loadThread(room.id));
	});

	$effect(() => {
		if (editingId && !timeline.some((item) => item.kind === 'message' && item.event.message_id === editingId && !item.event.deleted)) {
			untrack(endEdit);
		}
	});

	// At the latest while pinned there, anchored at the pane's bottom edge, and watching whether the latest shows.
	viewport.watchLatest();

	onMount(() => trackKeyboard());

	onMount(() => {
		passkeyUnavailable = passkeySupportError();
		sidebar.load();
		memberList.load();
		requestAnimationFrame(() => requestAnimationFrame(() => (slidesReady = true)));
		const memberListMedia = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
		const memberListMediaChange = ({ matches }: { matches: boolean }) => {
			memberListWide = matches;
			memberListOverlay = false;
		};
		memberListMediaChange(memberListMedia);
		memberListMedia.addEventListener('change', memberListMediaChange);
		const narrowMedia = window.matchMedia(`(max-width: ${NARROW_MAX - 1}px)`);
		const narrowMediaChange = ({ matches }: { matches: boolean }) => (narrow = matches);
		narrowMediaChange(narrowMedia);
		layoutKnown = true;
		const stopFirstScreen = watchFirstScreen();
		narrowMedia.addEventListener('change', narrowMediaChange);
		// Taken, and scrubbed from the address bar, before anything else can read or keep the URL.
		const signInLink = previewMode ? undefined : takeSignInLink(window.location, scrubUrl);
		// A link pasted into this tab later is a same-document fragment change: take (and scrub) it too.
		const hashChanged = (event: HashChangeEvent) => {
			// Preferences opening, closing or changing section (`ProfileBar`) doesn't move the page.
			if (onlyPreferencesDiffer(event.oldURL, event.newURL)) return;
			const link = previewMode ? undefined : takeSignInLink(window.location, scrubUrl);
			if (link) {
				links.follow(link);
				return;
			}
			// A push notification clicked while this app was already open, and too frozen to answer the service
			// worker (a phone's, in the background): the address it opened, which an app with one window may take
			// as this fragment change rather than a load.
			const pushed = previewMode ? undefined : takePushRoom();
			if (pushed) {
				if (client) void followPush(client, pushed);
				return;
			}
			// The page's place is all in the fragment, so a destination pasted into this tab doesn't reload it: go there.
			// Back and Forward between the page's own places fire this too, after the router has restored them.
			const destination = readDestination(window.location);
			const here = destination.room === page.state.room && destination.thread === page.state.thread && !destination.message && !destination.user;
			if (!here || (!previewMode && (destination.server ?? homeServer()) !== client?.url)) followDestination(destination);
		};
		window.addEventListener('hashchange', hashChanged);
		document.addEventListener('click', apronLinkClicked);
		serverInput = previewMode ? PREVIEW_SERVER : loadServerUrl() ?? defaultWebSocketUrl(window.location);
		displayName = previewMode ? 'Preview User' : loadDisplayName();
		recentServers = previewMode ? [] : loadRecentServers();
		notificationsEnabled = loadNotificationsEnabled();
		notificationsChoiceMade = notificationsChosen();
		installAnswered = installOfferAnswered();
		notificationState = notificationPermission();
		if (!previewMode) pushSettings.load();
		// Where images load from holds for an export read here too.
		mediaSettings.load();
		receiptSettings.load();
		webPushAvailable = webPushSupported();
		runsInstalled = isStandalone();
		// Push turned on or off, and descriptions put away, in another tab apply here too.
		const storageChanged = (event: StorageEvent) => {
			if (previewMode) return;
			pushSettings.storageChanged(event.key);
			// Not keeping history, or keeping less, chosen in another tab: this one stops or prunes too.
			historySettings.storageChanged(event.key);
			mediaSettings.storageChanged(event.key);
			receiptSettings.storageChanged(event.key);
			if (event.key === NOTIFY_SCOPES_KEY) notifyScopesSaved += 1;
			// A description put away or brought back in another tab is here too.
			if (event.key === HIDDEN_DESCRIPTIONS_KEY) hiddenDescriptions = loadHiddenDescriptions();
			// The install offer answered in another tab is answered here too.
			if (event.key === INSTALL_OFFER_KEY) installAnswered = installOfferAnswered();
		};
		window.addEventListener('storage', storageChanged);
		// Any input on the page means someone is attending it (§4.5 `idle`). Captured, so a
		// handler that stops an event's propagation doesn't hide it.
		const inputOptions = { capture: true, passive: true };
		const pressed = () => presence.input(true);
		const moved = () => presence.input();
		for (const type of ['keydown', 'pointerdown'] as const) window.addEventListener(type, pressed, inputOptions);
		for (const type of ['pointermove', 'wheel', 'touchmove'] as const) window.addEventListener(type, moved, inputOptions);
		// Chromium offers to install Apron: kept quiet, for the push setting to offer.
		const installOffered = (event: Event) => {
			event.preventDefault();
			installPrompt = event as InstallPromptEvent;
		};
		const installed = () => {
			installPrompt = undefined;
			installAnswered = true;
			answerInstallOffer();
		};
		window.addEventListener('beforeinstallprompt', installOffered);
		window.addEventListener('appinstalled', installed);
		// A push notification clicked with no tab open opens one at its room.
		const pushed = previewMode ? undefined : takePushRoom();
		const worker = navigator.serviceWorker;
		worker?.addEventListener('message', notificationClicked);
		let permission: PermissionStatus | undefined;
		navigator.permissions?.query({ name: 'notifications' }).then((status) => {
			permission = status;
			status.onchange = refreshNotificationPermission;
		}).catch(() => undefined);
		// A link's server (issue #32): one used here before is switched to at once; any other is offered on the
		// connect screen first, since connecting is up to the viewer. A notification's own room comes first.
		const link = pushed ? {} : readDestination(window.location);
		// A link without a server is for the page's own, wherever this browser was last; that one needs no asking.
		const start = previewMode ? undefined : startServer(serverInput, link, recentServers, window.location);
		const offeredServer = start?.offered;
		if (start && start.server !== normalizeWebSocketUrl(serverInput, window.location)) {
			serverInput = start.server;
			saveServerUrl(start.server);
		}
		const chat = new ChatClient(
			normalizeWebSocketUrl(serverInput, window.location),
			displayName,
			webSocketFactory,
			undefined,
			// The connection opened as the app started, to this server (`hooks.client.ts`), if it's still there.
			{ earlyConnection: takeEarlyConnection }
		);
		if (!previewMode) {
			// Made as the app started, and reading what it restores since (`$lib/history/startup`).
			historyKeeper = takeKeeper();
			keptRetention = historySettings.retention;
		}
		const keeper = historyKeeper;
		// The view from this device's last visit, while this one signs in and catches up: only for the session
		// saved here, which is the account it was kept for (a sign-in as anyone else drops it).
		void viewKeeper.restore(chat, (view) => {
			if (client === chat) session.prime(view);
		});
		const unsubscribe = chat.subscribe((next) => {
			serverUrl = chat.url;
			session.apply(next, chat);
			directory.apply(next, serverOrigin(chat.url), chat.url);
			noteArrivals(next);
		});
		// Each session the client begins goes on from what this device kept for its server.
		keeper?.watch(chat);
		chat.start();
		client = chat;
		if (signInLink) links.follow(signInLink);
		if (pushed) void followPush(chat, pushed);
		if (link.room) linked = { ...link, server: offeredServer ?? chat.url, room: link.room };
		if (offeredServer) {
			serverInput = offeredServer;
			offeringLink = true;
			openConnect();
		}
		return () => {
			stopFirstScreen();
			memberListMedia.removeEventListener('change', memberListMediaChange);
			narrowMedia.removeEventListener('change', narrowMediaChange);
			window.removeEventListener('hashchange', hashChanged);
			document.removeEventListener('click', apronLinkClicked);
			window.removeEventListener('storage', storageChanged);
			for (const type of ['keydown', 'pointerdown'] as const) window.removeEventListener(type, pressed, inputOptions);
			for (const type of ['pointermove', 'wheel', 'touchmove'] as const) window.removeEventListener(type, moved, inputOptions);
			window.removeEventListener('beforeinstallprompt', installOffered);
			window.removeEventListener('appinstalled', installed);
			if (typingIn) clearTimeout(typingIn.timer);
			if (highlightTimer) clearTimeout(highlightTimer);
			viewport.dispose();
			presence.dispose();
			worker?.removeEventListener('message', notificationClicked);
			if (permission) permission.onchange = null;
			feedback.dispose();
			mentions.dispose();
			session.dispose();
			unsubscribe();
			void keeper?.stop();
			chat.stop();
		};
	});

	// --- Connecting ---

	// A link for an addition this browser proposed (§4.11.3) approves only on a connection signed in to the
	// account that proposed it: once this page's session has settled, it adds there, or says it can't.
	$effect(() => links.settle(snapshot));

	/** Replaces the page's URL without adding a history entry: through the router once it runs, else the browser. */
	function scrubUrl(url: string): void {
		try {
			replaceState(url, page.state);
		} catch {
			history.replaceState(history.state, '', url);
		}
	}

	/**
	 * The profile's "Sign in with a passkey" (or "with email") opens here too,
	 * carrying the handle typed there. `signIn` asks for whichever sign-in the
	 * server offers: a passkey, which starts from a guest session, else email.
	 */
	function openConnect(options: { scheme?: Scheme; signIn?: boolean; name?: string } = {}): void {
		if (previewMode) return;
		const offered = session.server?.auth ?? [];
		// Signing in is what `auth` lists (§3.1): a passkey first where it signs in and there are guests to
		// start the ceremony from, or email doesn't sign in; email otherwise (it may be the way to join).
		const any = [...offered, ...(session.server?.signup ?? [])];
		const passkeyFirst = offered.includes('webauthn') ? offered.includes('guest') || !offered.includes('email') : !any.includes('email');
		connectScheme = options.scheme ?? (options.signIn ? (passkeyFirst ? 'webauthn' : 'email') : undefined);
		// Asked to sign in here, it opens at signing in; otherwise at choosing the server (another, a link's, or this one again).
		connectChoosing = !options.scheme && !options.signIn;
		links.failure = undefined;
		if (options.name) displayName = options.name;
		connectOpen = true;
	}

	/** Asks `room_list` for the pane's members, unless a listing was answered within `maxAge`. */
	function listMembers(maxAge: number): void {
		const room = paneRoom;
		if (!client || !room || !session.ready || !session.canManageRooms) return;
		client.listMembers(room.id, maxAge).catch(() => undefined);
	}

	/**
	 * The server pane's Disconnect: whatever belonged to this server goes, the connection closes, and the connect
	 * screen opens, where connecting again (here, or to another server) is the way back. What was kept for it stays.
	 */
	function disconnect(): void {
		if (!client || previewMode) return;
		leaveBackend();
		client.disconnect();
		disconnected = true;
		openConnect();
	}

	/** The connect form was submitted: whatever belonged to the previous backend goes. */
	function leaveBackend(): void {
		drafts.open(undefined);
		selectedRoomId = undefined;
		activeThread = undefined;
		pendingOpen = undefined;
		pendingJoin = undefined;
		newThread = undefined;
		roomEditorOpen = false;
		selection.leave();
		mentions.reset();
		unread.reset();
		arrivals.reset();
		incomingMessages.reset();
		pushRoom = undefined;
		session.forget();
		directory.forget();
	}

	/**
	 * The one Notifications switch. On asks for permission from this tap, then turns on the
	 * page's notifications and, wherever push works here, push for this account, so Apron
	 * alerts this device whether it is open or closed. Off turns both off.
	 */
	async function toggleNotifications(): Promise<void> {
		// Using the switch is the choice the first-mention offer asks for.
		notificationsChoiceMade = true;
		notifyOffer = undefined;
		if (notificationsActive) {
			notificationsEnabled = false;
			saveNotificationsEnabled(false);
			const chat = client;
			const account = pushAccount;
			if (chat && account && webPushActive) await pushSettings.turnOff(chat, account);
			return;
		}
		notificationState = await requestNotificationPermission();
		if (notificationState !== 'granted') return;
		notificationsEnabled = true;
		saveNotificationsEnabled(true);
		if (webPushAvailable) await pushHere();
	}

	/** The first-mention offer's Turn on: the Notifications switch's, from the same tap. Refused, it stays off, and isn't offered again. */
	async function acceptNotifyOffer(): Promise<void> {
		await toggleNotifications();
		if (!notificationsActive) saveNotificationsEnabled(false);
	}

	/** The first-mention offer's Not now: off, chosen, and not offered again. */
	function declineNotifyOffer(): void {
		notificationsChoiceMade = true;
		notifyOffer = undefined;
		saveNotificationsEnabled(false);
	}

	/** Permission changes in the browser's site settings, outside the page. */
	function refreshNotificationPermission(): void {
		notificationState = notificationPermission();
	}

	/** Sends a sample OS/browser notification without enabling ongoing mention alerts. */
	async function testNotifications(): Promise<NotificationTestResult> {
		if (typeof Notification === 'undefined' || !globalThis.isSecureContext) {
			notificationState = 'unsupported';
			return 'unsupported';
		}
		let permission: NotificationPermissionState = Notification.permission;
		if (permission === 'default') permission = await requestNotificationPermission();
		notificationState = permission;
		if (permission === 'denied') return 'denied';
		if (permission !== 'granted') return 'unsupported';
		const shown = await showNotification('Apron', { body: 'This is a test. New messages will show up like this.', tag: 'apron:test', renotify: true }, () => window.focus());
		return shown ? 'sent' : 'error';
	}

	/** Desktop alerts are opt-in and limited to the selected message types while Apron is away. */
	async function notifyMessage(event: MessageRecord, mention: boolean): Promise<void> {
		const room = session.rooms.find((candidate) => candidate.id === event.room_id);
		if (!room || !client) return;
		const body = notificationBody(plainTextOf(event));
		const id = accountPushId;
		// Without a `push_id`, the server's address stands in for it: each tab of this server alerts once for a message.
		const owner = id ?? client.url;
		const target: NotificationTarget = {
			tab: tabId, server: client.url, roomId: room.parentRoomId ?? room.id, ...(room.parentRoomId ? { threadId: room.id } : {}), messageId: event.message_id,
			...(id ? { pushId: id } : {}), group: notificationGroup(owner, room.id)
		};
		const shown = await showNotification(notificationTitle(senderName(event), room), {
			body: body || embedsLabel(event.body?.embeds) || 'New message',
			// One per message, shared with the server's push of it (§4.9) and with this server's other tabs, the second
			// replacing the first quietly; a newer message in the room closes it.
			tag: messageNotificationTag(owner, event.message_id),
			renotify: false,
			data: target
		}, () => openNotificationTarget(target));
		if (!shown && mention) playPing();
	}

	function openNotificationTarget(target: NotificationTarget): void {
		window.focus();
		if (target.tab === tabId && target.server === client?.url) openAtMessage(target.roomId, target.threadId, target.messageId);
	}

	/**
	 * Opens a notification's room or thread, then its message, as a link to it
	 * would (`revealLinkedMessage`). The message no longer there (deleted, or
	 * too far back) leaves the pane where it opened, as if none were named.
	 */
	function openAtMessage(roomId: string, thread: string | undefined, messageId: string | undefined): void {
		openDestination(roomId, thread);
		if (messageId) void revealLinkedMessage(roomId, thread, messageId, () => undefined);
	}

	/**
	 * The service worker relays a click on a notification it showed to the
	 * tabs, and asks each which account it is signed in to.
	 */
	function notificationClicked(event: MessageEvent): void {
		if (isJsonObject(event.data) && event.data.type === PUSH_ID_QUERY) {
			event.ports[0]?.postMessage({ pushId: accountPushId, tab: tabId });
			return;
		}
		const target = notificationClickTarget(event.data);
		if (target) openNotificationTarget(target);
		const pushed = pushClickTarget(event.data);
		if (pushed) openPushedRoom(pushed);
	}

	/** A push notification's room opens in a tab signed in to the account its `push_id` names. */
	function openPushedRoom(target: Pick<PushTarget, 'roomId' | 'pushId' | 'messageId'>): void {
		window.focus();
		pushRoom = target;
	}

	/**
	 * A tab opened for a push notification goes to the server of the account it
	 * was pushed for, if push is on for that account here and it isn't the
	 * remembered server, as the connect screen would.
	 */
	async function followPush(chat: ChatClient, target: Pick<PushTarget, 'roomId' | 'pushId' | 'messageId'>): Promise<void> {
		const id = target.pushId;
		if (id !== undefined) {
			for (const account of pushSettings.accounts) {
				if (pushSettings.pushId(account) !== id) continue;
				const server = accountServer(account);
				if (server && server !== chat.url) {
					leaveBackend();
					serverInput = server;
					saveServerUrl(server);
					chat.setUrl(server);
				}
				break;
			}
		}
		openPushedRoom(target);
	}

	/** Takes, and scrubs from the address bar, the room, `push_id` and message of a push notification this tab was opened for, in its fragment. */
	function takePushRoom(): Pick<PushTarget, 'roomId' | 'pushId' | 'messageId'> | undefined {
		const url = new URL(window.location.href);
		const fragment = new URLSearchParams(url.hash.slice(1));
		const roomId = fragment.get(PUSH_ROOM_PARAM) ?? undefined;
		const id = fragment.get(PUSH_ID_PARAM) || undefined;
		const messageId = fragment.get(PUSH_MESSAGE_PARAM) || undefined;
		if (roomId === undefined) return undefined;
		fragment.delete(PUSH_ROOM_PARAM);
		fragment.delete(PUSH_ID_PARAM);
		fragment.delete(PUSH_MESSAGE_PARAM);
		url.hash = fragment.toString();
		scrubUrl(url.toString());
		return roomId ? { roomId, ...(id ? { pushId: id } : {}), ...(messageId ? { messageId } : {}) } : undefined;
	}

	/** Pauses notifications everywhere (§4.5 `mute`): seconds from now, or until resumed. */
	function pauseNotifications(until: PausedUntil): Promise<void> {
		return client?.setMute(muteFor(until)) ?? Promise.resolve();
	}

	/** What to notify about, kept per account; push registers again with the new `wake` at once. */
	function setNotifyScopes(scopes: string[]): void {
		if (!scopes.length) return;
		saveNotifyScopes(notifyKey, scopes);
		notifyScopesSaved += 1;
	}

	/**
	 * Chromium's install prompt, from the push setting's Install app button or the install offer's Install: offered
	 * once, and either answers the install offer, so it doesn't come back with the steps once the prompt is gone.
	 */
	async function installApp(): Promise<void> {
		const prompt = installPrompt;
		installPrompt = undefined;
		installAnswered = true;
		answerInstallOffer();
		await prompt?.prompt().catch(() => undefined);
	}

	/** The install offer's Not now, or Got it once its steps are read: not made again. */
	function declineInstallOffer(): void {
		installAnswered = true;
		answerInstallOffer();
	}

	/**
	 * Push for this account (§4.9), so this device is alerted while Apron is closed: with
	 * the Notifications switch, or its action while notifications are on but push isn't
	 * here yet (another account turned them on, or a sign-in since). Asks for permission
	 * first if need be, from this tap, and takes the browser's one subscription over
	 * from another server holding it. Off goes with the switch (`PushSettings.turnOff`).
	 */
	async function pushHere(): Promise<void> {
		const chat = client;
		const account = pushAccount;
		const key = webPushServerKey;
		const userId = session.you?.user_id;
		if (!chat || !account || !userId) return;
		if (webPushActive && webPushHeldBy) {
			if (key) await pushSettings.enable(chat, key, userId, webPushWake);
			return;
		}
		if (webPushActive) return;
		if (notificationState !== 'granted') notificationState = await requestNotificationPermission();
		if (notificationState !== 'granted') return;
		notificationsEnabled = true;
		saveNotificationsEnabled(true);
		await pushSettings.turnOn(chat, userId, key, webPushWake, session.ready);
	}

	/**
	 * Signing out: notes the account push is on for while `you` still names
	 * it, and returns what to do once the session is gone: push goes off for
	 * that account here, so its previews stop even if the server can't be
	 * told. A sign-out that fails never calls it, so push stays on.
	 */
	function signedOut(): () => void {
		const account = pushAccount;
		const chat = client;
		return () => {
			if (chat && account) void pushSettings.signedOut(chat, account);
			if (chat) void viewKeeper.forget(chat.url);
			// History kept here stays, for when this account signs in again: deleting it is its own choice (Sign out's
			// Keep local history, or Clear in Preferences).
			session.forget();
		};
	}

	function connected(options: { remember?: boolean } = {}): void {
		if (previewMode) return;
		if (client) {
			recentServers = rememberServer(recentServers, client.url, currentLook);
			// How it signed in here is offered first next time, through signing out too: a sign-out's guest isn't kept.
			const scheme = options.remember === false ? undefined : signedInScheme(client.snapshot());
			if (scheme) saveLastSignIn(client.url, scheme);
		}
		connectOpen = false;
		offeringLink = false;
		disconnected = false;
	}

	// --- Navigation and drafts ---

	/**
	 * Opens what the page's URL named, as far as this server shows it: the room
	 * (joined, or read without joining), then the thread under it once the
	 * room's threads are listed, then the message. Each step replaces the URL's
	 * history entry rather than adding one; the effect calls it again as each
	 * step lands.
	 */
	function openLinked(target: Destination & { server: string; room: string; searched?: boolean }): void {
		if (!client) return;
		const listed = (id: string) => session.rooms.some((room) => room.id === id);
		// A link names a thread by its room_id alone (Appendix A.4): it opens under the parent its record names.
		if (!target.thread) {
			const parent = threadParent(client, target.server, target.room);
			if (parent === undefined) return;
			if (parent) {
				linked = { ...target, room: parent, thread: target.room };
				return;
			}
		}
		// Until it has all opened, the URL keeps naming the whole link, so a reload tries it again.
		const keepLink = () => scrubUrl(addressOf(target.room, target.thread, target.message));
		if (activeRoom?.id !== target.room) {
			if (!listed(target.room) && !client.viewRoom(target.room)) {
				// Not among the rooms to join either, once those are listed: this server doesn't show it here.
				// A listing kept from before a drop doesn't count: the room may be newer than it.
				if ((session.snapshot.directory !== undefined && !session.snapshot.keptListings?.includes('')) || !session.canManageRooms) abandonLink('room');
				return;
			}
			session.chooseRoom(client, target.room);
			setDestination(target.room, undefined, 'replace');
			keepLink();
			return;
		}
		// A link to the room itself closes a thread open under it.
		if (!target.thread && activeThread) {
			setDestination(target.room, undefined, 'replace');
			keepLink();
			return;
		}
		if (target.thread && activeThread !== target.thread) {
			if (!listed(target.thread) && !client.viewRoom(target.thread)) {
				// The room's threads are listed without it: the room is as far as the link goes.
				if ((session.snapshot.threadDirectory[target.room] !== undefined && !session.snapshot.keptListings?.includes(target.room)) || !session.canManageRooms) abandonLink('thread');
				return;
			}
			showThread(target.room, target.thread, 'replace');
			keepLink();
			return;
		}
		linked = undefined;
		// On a phone the rooms list makes way for the pane, as picking a room does: its entry is the pane's now, so Back
		// doesn't show it again. Opening another room or thread above took the entry already.
		if (page.state.rooms) {
			try {
				replaceState(window.location.href, target.thread ? { room: target.room, thread: target.thread } : { room: target.room });
			} catch {
				// The router isn't started yet (in development): the list just stays its entry.
			}
		}
		mobilePane = 'main';
		if (target.message) void revealLinkedMessage(target.room, target.thread, target.message, () => abandonLink('message', target.searched));
		if (target.user) void revealLinkedUser(target.thread ?? target.room, target.user);
	}

	/**
	 * The parent of `roomId` if it is a thread, `null` if it isn't, or
	 * `undefined` until that is known. A room the user hasn't joined is looked
	 * up once (`room_list` with `room_id`, §4.2.1), and the link opens again
	 * when the answer comes; one the server won't list counts as no thread.
	 */
	function threadParent(chat: ChatClient, server: string, roomId: string): string | null | undefined {
		const joined = session.rooms.find((room) => room.id === roomId);
		if (joined) return joined.parentRoomId ?? null;
		const key = `${server} ${roomId}`;
		if (linkedParents.has(key)) return linkedParents.get(key);
		linkedParents.set(key, undefined);
		const settle = (parent: string | null) => {
			linkedParents.set(key, parent);
			if (linked?.room === roomId && !linked.thread) linked = { ...linked };
		};
		chat.listMembers(roomId).then((listings) => settle(listings.find((listing) => listing.id === roomId)?.parentRoomId ?? null), () => settle(null));
		return undefined;
	}

	// --- Search ---

	/** Search can be opened: signed in, with rooms listed. */
	let canSearch = $derived(Boolean(client) && session.ready);
	/** Search's shortcut, as this platform writes it; none on a touch screen, which has no keys for it. */
	const searchHint = globalThis.matchMedia?.('(pointer: coarse)').matches ? undefined : onMac() ? '⌘F' : 'Ctrl+F';
	/** The shortcuts of search's two modes, beside their names; none on a touch screen. */
	const searchKeys = searchHint === undefined ? undefined : searchHint === '⌘F' ? { rooms: '⌘K', messages: '⌘F' } : { rooms: 'Ctrl K', messages: 'Ctrl F' };

	/** What keeps this session's history on this device, if anything does: a session saved here, while keeping is on. */
	function sessionKeeper(): HistoryKeeper | undefined {
		return historyKeeper && session.passkeySession && client?.keptSessionFor(client.url) && historySettings.retention !== 'off' ? historyKeeper : undefined;
	}

	/** What Search looks through, in words: history kept on this device for this session, and what is loaded. */
	function searchNote(): string {
		if (!sessionKeeper()) return 'Messages loaded on this page.';
		const span = { '1': 'the last day', '7': 'the last week', '30': 'the last 30 days', '365': 'the last year' }[historySettings.retention as string];
		return `Messages kept on this device${span ? ` from ${span}` : ''}, and those loaded now.`;
	}

	/**
	 * Search's link to History: Preferences, at History. On a phone the profile bar that owns Preferences is in the
	 * rooms list, which shows first.
	 */
	function showHistoryPreferences(): void {
		if (mobilePane !== 'rooms' && window.innerWidth < NARROW_MAX) openRooms();
		preferencesOpener.open('history');
	}

	/** A search result picked: it opens where it is, as a link to it would, paging back to it. */
	function openFound(message: MessageRecord): void {
		if (!client) return;
		linked = { server: client.url, room: message.room_id, message: message.message_id, searched: true };
	}

	/**
	 * A room or thread picked in search: one shown opens as a mention of it would; any other as a
	 * link to it does, read without joining, under its room if it's a thread (`openLinked`).
	 */
	function openSwitched(roomId: string): void {
		if (!client) return;
		const room = session.rooms.find((candidate) => candidate.id === roomId);
		if (room && (room.parentRoomId === undefined || session.rooms.some((candidate) => candidate.id === room.parentRoomId))) openMentionedRoom(roomId);
		else linked = { server: client.url, room: roomId, searched: true };
	}

	/** Part of a link isn't here: the URL says where the page is instead, and a toast says what wasn't found. */
	function abandonLink(missing: 'room' | 'thread' | 'message', searched = linked?.searched): void {
		// A room or thread picked in search is searched for with no message.
		const found = linked?.message !== undefined;
		linked = undefined;
		feedback.error(!searched ? `The linked ${missing} isn’t available here.` : missing === 'message' ? 'That message is too far back to open here.' : found ? `That message’s ${missing} isn’t available here.` : `That ${missing} isn’t available here.`);
		scrubUrl(addressOf(selectedRoomId, activeThread));
	}

	/**
	 * Opens the profile card of a link's user (Appendix A.4) in the open room
	 * or thread. A member it doesn't list is looked for there first, since a
	 * large room may list only its recently active members (§4.2.1); the card
	 * opens either way, and says whether they are in the room. It sits by
	 * their row in the member list when that shows them, else by the room's name.
	 */
	async function revealLinkedUser(roomId: string, userId: string): Promise<void> {
		const chat = client;
		if (!chat) return;
		const room = session.rooms.find((candidate) => candidate.id === roomId);
		const member = room?.members?.some((candidate) => candidate.user_id === userId) || await chat.findMember(roomId, userId).catch(() => false);
		if (client !== chat || (activeThread ?? activeRoom?.id) !== roomId) return;
		await tick();
		const anchor = document.querySelector<HTMLElement>(`button.ap-member-who[data-user-id="${CSS.escape(userId)}"]`)
			?? document.querySelector<HTMLElement>('.ap-roomhead-name');
		if (anchor && !profileCard.current) profileCard.toggle({ anchor, userId, member });
	}

	/**
	 * Scrolls to a linked message in the open room or thread, paging back
	 * through its history until it is loaded: a `message_id` is the `log_id` it
	 * was created at (§2), so once what's loaded reaches back past that, it
	 * isn't here. Only the linked room or thread is searched; `missing` runs
	 * when the message isn't in it.
	 */
	async function revealLinkedMessage(roomId: string, thread: string | undefined, id: string, missing: () => void): Promise<void> {
		const paneId = thread ?? roomId;
		const pane = () => session.rooms.find((room) => room.id === paneId);
		const isOpen = () => activeRoom?.id === roomId && activeThread === thread;
		const found = () => Boolean(pane()?.timeline.events[id]);
		await until(() => Boolean(pane()?.loaded) || !isOpen(), JUMP_WAIT_MS * 2);
		for (let page = 0; page < LINKED_MESSAGE_PAGES && client && isOpen() && !found(); page++) {
			const room = pane();
			const oldest = room?.timeline.order[0];
			if (!room?.olderAvailable || (oldest !== undefined && compareLogIds(oldest, id) <= 0)) break;
			try {
				await client.loadOlder(paneId);
			} catch {
				break;
			}
		}
		if (!isOpen()) return;
		if (!found()) {
			missing();
			return;
		}
		await jumpToMessage(id);
		scrubUrl(addressOf(roomId, thread, id));
	}

	/**
	 * The page's URL for a destination: its server (left out where it's the one
	 * the page connects to anyway), room, thread and message. Never anything
	 * that signs in.
	 */
	function addressOf(roomId: string | undefined, thread?: string, message?: string): string {
		const server = client && !previewMode ? { server: client.url } : {};
		return destinationUrl(window.location.href, { ...server, ...(roomId ? { room: roomId } : {}), ...(thread ? { thread } : {}), ...(message ? { message } : {}) }, homeServer());
	}

	/** The server the page connects to when nothing says otherwise: a URL without `server` names it. */
	function homeServer(): string {
		return normalizeWebSocketUrl(defaultWebSocketUrl(window.location), window.location);
	}

	/**
	 * Copies a link to a message that any Apron app opens (Appendix A.4): its
	 * server, the room or thread it's in, and the message itself.
	 */
	async function copyMessageLink(event: MessageRecord): Promise<boolean> {
		const destination = destinationOf(event);
		if (!destination || !client) return false;
		try {
			await navigator.clipboard.writeText(writeApronLink({ server: client.url, room: destination.thread ?? destination.room, message: event.message_id }));
			return true;
		} catch {
			feedback.error('Unable to copy the link');
			return false;
		}
	}

	/** Copies a link to the open room, or to the thread open in it by its room_id, that any Apron app opens (Appendix A.4). */
	async function copyPaneLink(): Promise<boolean> {
		const roomId = activeThread ?? activeRoom?.id;
		if (!roomId || !client) return false;
		try {
			await navigator.clipboard.writeText(writeApronLink({ server: client.url, room: roomId }));
			return true;
		} catch {
			feedback.error('Unable to copy the link');
			return false;
		}
	}

	/**
	 * Opens an Apron link from a message here, in place of the link.apron.chat
	 * page (Appendix A.4). A link to this server, or one without a server, opens
	 * its room, message or user. One to another server asks before switching
	 * this tab to it (a plain click opens such a link in a new tab instead,
	 * `apronLinkClicked`). One with a token asks before signing in, as a
	 * sign-in link does. Opening never acts.
	 */
	function openApronLink(link: ApronLink): void {
		if (!client || previewMode) return;
		const server = link.server ?? client.url;
		if (link.token) {
			links.follow({ token: link.token, server, ...(link.state ? { state: link.state } : {}) });
			return;
		}
		followDestination({ server, ...(link.room ? { room: link.room, ...(link.message ? { message: link.message } : {}), ...(link.user ? { user: link.user } : {}) } : {}) });
	}

	/**
	 * Goes to a destination named after the page loaded: a fragment pasted
	 * into this tab, or an Apron link clicked. Without a server it is the
	 * page's own, as on load. On this server it opens at once; on another, the
	 * connect screen asks first, as for a server not used before, and the
	 * destination opens once connected there (or goes if the viewer stays).
	 */
	function followDestination(destination: Destination): void {
		if (!client || !destination.room) return;
		const server = previewMode ? client.url : destination.server ?? homeServer();
		if (server !== client.url) {
			serverInput = server;
			offeringLink = true;
			openConnect();
		}
		linked = { ...destination, server, room: destination.room };
	}

	/**
	 * A plain click on an Apron link anywhere on the page opens it here (`openApronLink`); a modified one is left to the browser.
	 * A place on another server opens this app in a new tab instead (`elsewhereUrl`), so the connection here stays.
	 * A token's link still opens here: signing in asks first, and a `state` is this tab's own.
	 */
	function apronLinkClicked(event: MouseEvent): void {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const anchor = (event.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]');
		const link = anchor ? readApronLink(anchor.getAttribute('href') ?? '') : undefined;
		if (!link) return;
		event.preventDefault();
		if (client && !previewMode && !link.token && link.server !== undefined && link.server !== client.url) {
			window.open(elsewhereUrl(window.location, link, homeServer()), '_blank', 'noopener');
			return;
		}
		openApronLink(link);
	}

	function chooseRoom(room: RoomSnapshot): void {
		if (!client) return;
		mentions.clearRoom(room.id);
		session.chooseRoom(client, room.id);
		setDestination(room.id, undefined);
		closeRooms();
		composer?.focus();
	}

	/**
	 * Shows the rooms list over the open room or thread (phones), as a history
	 * entry of its own: Back or the list's › returns to it (picking the open
	 * room folds its threads, staying in the list), and picking another takes
	 * the entry's place.
	 */
	function openRooms(): void {
		mobilePane = 'rooms';
		if (page.state.rooms || selectedRoomId === undefined) return;
		try {
			pushState('', { ...(activeThread ? { room: selectedRoomId, thread: activeThread } : { room: selectedRoomId }), rooms: true });
		} catch {
			// The router isn't started yet (in development): the list just isn't an entry Back leaves.
		}
	}

	/** Returns from the rooms list to the room or thread it opened over: Back, while the list is the current entry. */
	function closeRooms(): void {
		mobilePane = 'main';
		if (page.state.rooms) window.history.back();
	}

	/** Drafts are kept per room, and a thread is a room of its own. */
	function draftKey(roomId: string): string {
		return JSON.stringify([client?.url ?? serverInput, roomId]);
	}

	/**
	 * Moves the pane to a room or one of its threads, keeping each destination's
	 * draft and reply. Each move is a history entry, so Back returns to the
	 * previous room or thread; the first one replaces the entry the page opened with.
	 */
	function setDestination(roomId: string, thread: string | undefined, history: 'push' | 'replace' = 'push'): void {
		if (selectedRoomId === roomId && activeThread === thread) return;
		recordDestination(roomId, thread, selectedRoomId === undefined ? 'replace' : history);
		selectedRoomId = roomId;
		activeThread = thread;
		drafts.open(draftKey(thread ?? roomId));
		editingId = undefined;
		roomEditorOpen = false;
		newThread = undefined;
		selection.leave();
		if (typingIn && typingIn.room !== (thread ?? roomId)) stopTyping();
		composer?.reset();
		if (!mentionAsk?.busy) mentionAsk = undefined;
		mentions.clearUnseen();
		mentions.clearRoom(roomId);
		if (thread) mentions.clearRoom(thread);
		viewport.openPane();
		// A thread's failed load is about that thread: leaving it takes the toast too.
		feedback.dismiss(threadError);
	}

	/** Writes the destination into the page's history entry, unless it is already there. */
	function recordDestination(roomId: string, thread: string | undefined, history: 'push' | 'replace'): void {
		const address = addressOf(roomId, thread);
		if (page.state.room === roomId && page.state.thread === thread) {
			// The same room on another server (after switching) still names the new server.
			if (address !== window.location.href) scrubUrl(address);
			return;
		}
		try {
			// A destination picked from the phone's rooms list takes the list's entry: Back doesn't return to the list.
			(history === 'push' && !page.state.rooms ? pushState : replaceState)(address, thread ? { room: roomId, thread } : { room: roomId });
		} catch {
			// The router isn't started yet (in development): this destination just isn't recorded.
		}
	}

	/**
	 * Returns to a destination from the history. A room left since can't be
	 * shown, so its entry becomes the current destination; a thread left since
	 * is read without joining, or else its room opens instead.
	 */
	function revisit(roomId: string, thread: string | undefined): void {
		if (!client || (selectedRoomId === roomId && activeThread === thread)) return;
		const listed = (id: string) => session.rooms.some((room) => room.id === id);
		if (!listed(roomId)) {
			if (selectedRoomId !== undefined) recordDestination(selectedRoomId, activeThread, 'replace');
			return;
		}
		if (thread && !listed(thread) && !client.viewRoom(thread)) thread = undefined;
		if (activeRoom?.id !== roomId) session.chooseRoom(client, roomId);
		if (thread) showThread(roomId, thread, 'replace');
		else setDestination(roomId, undefined, 'replace');
		mobilePane = 'main';
	}

	/** Opens a room, or a thread under it, switching the top-level room first when it differs. */
	function openDestination(roomId: string, thread: string | undefined): void {
		if (!client) return;
		if (activeRoom?.id !== roomId) session.chooseRoom(client, roomId);
		if (thread) showThread(roomId, thread);
		else setDestination(roomId, undefined);
		closeRooms();
	}

	/** Opens a thread from the sidebar: under the open room, or, with news, under another, whose room it opens too. */
	function chooseThread(thread: string): void {
		const parent = session.rooms.find((room) => room.id === thread)?.parentRoomId ?? activeRoom?.id;
		if (parent === undefined) return;
		if (parent !== activeRoom?.id) {
			openDestination(parent, thread);
			composer?.focus();
			return;
		}
		showThread(parent, thread);
		closeRooms();
		composer?.focus();
	}

	/** Shows a thread at its latest reply, as a room opens, loading it again if its last load failed. */
	function showThread(roomId: string, thread: string, history: 'push' | 'replace' = 'push'): void {
		setDestination(roomId, thread, history);
		// A failed load stays failed until the thread is opened again.
		if (session.rooms.find((room) => room.id === thread)?.recoveryError) loadThread(thread);
	}

	/**
	 * A thread card opens its thread. One you haven't joined is read through
	 * its history without joining it (joining logs a membership for everyone,
	 * §4.2.2); replying or Join makes it live.
	 */
	function openThreadCard(thread: string): void {
		if (!client) return;
		if (!session.rooms.some((room) => room.id === thread) && !client.viewRoom(thread)) {
			joinRoom(thread);
			return;
		}
		chooseThread(thread);
	}

	/**
	 * Loads a thread's history, or a room's read without joining it (§4.3); a failure the client recorded is reported once. One the server refuses for a
	 * while (`retry_after`) isn't a failure: the client waits it out and loads again, the timeline counting down
	 * meanwhile. A load that succeeds takes the last failure's toast away.
	 */
	function loadThread(roomId: string): void {
		client?.loadRoom(roomId).then(() => feedback.dismiss(threadError), (cause: unknown) => {
			if (!session.rooms.find((room) => room.id === roomId)?.recoveryError) return;
			threadError = feedback.error(cause, session.rooms.find((room) => room.id === roomId)?.parentRoomId === undefined ? 'Unable to load room' : 'Unable to load thread');
		});
	}

	function backToRoom(): void {
		if (!activeRoom) return;
		setDestination(activeRoom.id, undefined);
		composer?.focus();
	}

	function threadTitle(thread: string): string {
		return threads.find((entry) => entry.id === thread)?.title ?? thread;
	}

	// --- Composing ---

	function composerInput(): void {
		// The draft changed under the ask: Send asks again about what it mentions then.
		if (mentionAsk && !mentionAsk.busy) mentionAsk = undefined;
		if (!client || !paneRoom) return;
		drafts.saveText();
		// A live message shows itself as it is typed: no typing indicator besides.
		if (liveLoaded?.composing) return;
		const roomId = paneRoom.id;
		// Typing somewhere else now: it ends where it was, rather than show there until it runs out.
		if (typingIn && typingIn.room !== roomId) stopTyping();
		client.sendTyping(roomId, true);
		if (typingIn) clearTimeout(typingIn.timer);
		const timer = setTimeout(() => {
			if (typingIn?.timer === timer) typingIn = undefined;
			client?.sendTyping(roomId, false);
		}, 5000);
		typingIn = { room: roomId, timer };
	}

	/** Your typing indicator ends where it shows: you stopped, sent, or went elsewhere. */
	function stopTyping(): void {
		if (!typingIn) return;
		clearTimeout(typingIn.timer);
		client?.sendTyping(typingIn.room, false);
		typingIn = undefined;
	}

	/**
	 * Holds the draft back when it mentions people who aren't in the open room or thread, and you may add them: asks
	 * whether to first (`mentionAsk`). Those it mentions are the people its chips name; a role (`@&role`) mentions
	 * those here who hold it, so it asks about no one, unless no one else here holds it: then about everyone the
	 * session knows with it. Never for a command, which says itself what it does with whom it names: only a draft that
	 * goes as a message. True when it asked, and the draft waits.
	 */
	function askToAddMentioned(room: RoomSnapshot, text: string): boolean {
		if (!canAddMembers || session.snapshot.memberChangesUnsupported) return false;
		const action = composerAction(text, { command: session.capabilities.command, rooms: false });
		if (action.kind !== 'message') return false;
		const skip = (userId: string) => directory.isMe(userId) || isSystemId(userId) || isGuest(directory.person({ user_id: userId }) ?? { user_id: userId });
		const memberIds = new Set((room.members ?? []).map((member) => member.user_id));
		const withRoles = unheldRoleHolders(markdownRoles(action.text), Object.values(session.snapshot.users), memberIds, (userId) => directory.isMe(userId));
		const userIds = absentMentions([...composerMentions, ...withRoles], room, skip);
		if (!userIds.length) return false;
		mentionAsk = { roomId: room.id, userIds, busy: false, text, files: stagedIds() };
		// The ask shows above the compact composer, which the full panel would cover: back to it, the draft kept.
		composerExpanded = false;
		return true;
	}

	/** The draft's staged files, as `mentionAsk.files` keeps them. */
	function stagedIds(): string {
		return drafts.files.map((file) => file.id).join(' ');
	}

	/**
	 * The ask's Add and send: adds them (`room_join`, §4.2.2), then sends the draft, saying who the server wouldn't add.
	 * Send waits meanwhile in that pane (`holdSend`). The draft goes only if, once they're in, its pane is open and it
	 * is still the draft asked about; else it waits there to be sent, and asked about, again.
	 */
	async function addMentionedAndSend(): Promise<void> {
		const ask = mentionAsk;
		if (!client || !ask || ask.busy) return;
		mentionAsk = { ...ask, busy: true };
		const refused = await addMembers(client, ask.roomId, ask.userIds);
		if (mentionAsk?.roomId === ask.roomId) mentionAsk = undefined;
		if (refused.length) feedback.error(couldNotAdd(refused, (userId) => directory.name({ user_id: userId })));
		if (paneRoom?.id !== ask.roomId) return;
		composer?.focus();
		if (drafts.text !== ask.text || stagedIds() !== ask.files) return;
		// It goes, whoever was added, and mentions them, so a role no one here held mentions its holders now that
		// they're here.
		sendMessage(true, ask.userIds.filter((userId) => !refused.some((refusal) => refusal.userId === userId)));
	}

	/** Escape: an ask that isn't adding yet goes away, the draft unsent. True when there was one. */
	function dismissMentionAsk(): boolean {
		if (!mentionAsk || mentionAsk.busy) return false;
		mentionAsk = undefined;
		return true;
	}

	/**
	 * Sends the composer's text: a message with the draft's mentions (§3.5) and
	 * previews of its GitHub links as `link` embeds (§4.8.1), or
	 * with capability `command` a command (§4.1), which `/nick`, `/join`, `/leave`,
	 * `/topic`, `/kick` and `/invite` turn into the requests they spell. A
	 * command's failure shows as a local notice in the pane, where its replies
	 * land too.
	 *
	 * `asked`: the ask to add who it mentions was answered (MentionAddPrompt), so it goes as it is; `added`, whom that
	 * added, which it mentions besides its chips, such as the holders of a role no one here held when it was written.
	 */
	function sendMessage(asked = false, added: readonly string[] = []): void {
		if (!client || !paneRoom || !canCompose) return;
		// Adding who it mentions: it goes once they're in (`addMentionedAndSend`).
		if (mentionAsk?.busy && mentionAsk.roomId === paneRoom.id) return;
		// An ask adding elsewhere carries on there.
		if (!mentionAsk?.busy) mentionAsk = undefined;
		if (composingLive) {
			liveComposer?.send();
			composer?.focus();
			return;
		}
		// `/live` starts with an empty composer: files staged first would wait unseen, so they go or stay first.
		if (drafts.files.length && snapshot.capabilities['embed:append'] && /^\/live\s*$/i.test(drafts.text)) {
			feedback.error('Send or remove the attached files before typing live');
			return;
		}
		// Sending waits as the server asked, files or not (the client holds back any message meanwhile): Send
		// counts down, the draft and its files stay, and nothing goes by itself. A notice put away shows again.
		if (sendWait && sendWait.until > Date.now()) {
			dismissedSendWait = undefined;
			return;
		}
		if (drafts.files.length && uploadWait && uploadWait.until > Date.now()) {
			dismissedUploadWait = undefined;
			return;
		}
		if (drafts.files.length) {
			if (!asked && askToAddMentioned(paneRoom, drafts.text)) return;
			void sendFiles(added);
			return;
		}
		if (!drafts.text.trim()) return;
		if (!asked && askToAddMentioned(paneRoom, drafts.text)) return;
		const chat = client;
		const draft = drafts.text;
		const roomId = paneRoom.id;
		const reply = drafts.reply;
		const originKey = draftKey(roomId);
		const mentions = [...new Set([...composerMentions, ...added])];
		const dismissed = drafts.dismissed;
		const action = composerAction(draft, { command: snapshot.capabilities.command, rooms: session.canManageRooms, members: !snapshot.memberChangesUnsupported, append: snapshot.capabilities['embed:append'] }, mentions);
		if (action.kind === 'live') {
			startLive(chat, paneRoom, reply);
			return;
		}
		// A draft given back keeps the link previews that were removed from it.
		const restore = () => {
			if (drafts.restore(originKey, draft, reply, [], dismissed)) composer?.focus();
		};
		const options = { ...(reply ? { replyTo: reply } : {}), ...(mentions.length ? { mentions } : {}) };
		if (action.kind === 'message') {
			if (!action.text.trim()) return;
			const embeds = linkPreviews.embeds(action.text, dismissed);
			const post = () => feedback.track(chat.send(roomId, action.text, 'markdown', { ...options, ...(embeds.length ? { embeds } : {}) }), 'Sending…', restore);
			const joining = joinFirst(chat, paneRoom);
			if (joining) {
				joining.then(post, (cause: unknown) => {
					feedback.error(cause, `Unable to join the ${paneRoom.parentRoomId === undefined ? 'room' : 'thread'}`);
					restore();
				});
			} else {
				post();
			}
			viewport.pin();
		} else {
			const failed = (cause: unknown) => {
				chat.notify(roomId, cause instanceof Error && cause.message ? cause.message : 'The command failed');
				restore();
			};
			if (action.kind === 'command') {
				chat.command(roomId, draft, options).promise.catch(failed);
			} else if (action.kind === 'nick') {
				displayName = action.name;
				saveDisplayName(action.name);
				chat.setDisplayName(action.name)?.promise.catch(failed);
			} else if (action.kind === 'join') {
				joinByName(action.room, failed);
			} else if (action.kind === 'leave') {
				const leaving = action.room ?? roomId;
				if (leaving === roomId && activeThread && activeRoom) backToRoom();
				chat.leaveRoom(leaving).promise.catch(failed);
			} else if (action.kind === 'topic') {
				chat.updateRoom(roomId, { description: action.description }).promise.catch(failed);
			} else {
				// `/kick @user` and `/invite @user` as `room_leave`/`room_join` with `user_id` (§4.2.2). A server
				// that answers `unsupported` may still have the command itself (§4.1): it gets the text as typed.
				const change = action.kind === 'kick' ? chat.leaveRoom(roomId, action.user) : chat.joinRoom(roomId, action.user);
				change.promise.catch((cause: Error & { code?: number }) => {
					if (cause.code === UNSUPPORTED) chat.command(roomId, draft, options).promise.catch(failed);
					else failed(cause);
				});
			}
		}
		clearComposer(roomId);
		chat.sendTyping(roomId, false);
		stopTyping();
		composer?.focus();
	}

	/**
	 * `/live` (capability `embed:append`): the composer types the next message live (`LiveComposer`, loaded on demand,
	 * so the composer costs nothing more until then).
	 */
	function startLive(chat: ChatClient, room: RoomSnapshot, reply: string | undefined): void {
		const key = draftKey(room.id);
		import('$lib/ui/live-composer.svelte').then(({ LiveComposer }) => {
			if (client !== chat || !paneRoom || draftKey(paneRoom.id) !== key) return;
			liveComposer ??= liveLoaded = new LiveComposer({
				client: () => client,
				paneKey: () => (paneRoom ? draftKey(paneRoom.id) : undefined),
				draft: () => ({ text: drafts.text, mentions: composerMentions, reply: drafts.reply }),
				canEdit: () => session.canEdit,
				forget: (forgotten) => drafts.forget(forgotten),
				restore: (restored, text, replyTo) => {
					if (drafts.restore(restored, text, replyTo)) composer?.focus();
				},
				started: () => {
					stopTyping();
					viewport.pin();
					composer?.focus();
				},
				error: (cause, fallback) => feedback.error(cause, fallback)
			});
			liveComposer.start(chat, room.id, key, reply, joinFirst(chat, room));
		}, (cause: unknown) => feedback.error(cause, 'Unable to start live typing'));
	}

	/** `/join`: a room you're in opens; another, found by ID or title among those listed, is joined and opens once it arrives. */
	function joinByName(name: string, failed: (cause: unknown) => void): void {
		if (!client) return;
		const wanted = name.toLowerCase();
		// Only a room you've joined just opens: one open to read without joining (picked under Other Rooms) is joined.
		const mine = session.rooms.filter((room) => room.joined);
		const joined = mine.find((room) => room.id === name) ?? mine.find((room) => room.title.toLowerCase() === wanted);
		if (joined) {
			openMentionedRoom(joined.id);
			return;
		}
		const listed = [...(snapshot.directory ?? []), ...Object.values(snapshot.threadDirectory).flat()];
		const target = listed.find((listing) => listing.id === name) ?? listed.find((listing) => listing.title.toLowerCase() === wanted);
		const room = target?.id ?? name;
		pendingJoin = { room, private: false };
		client.joinRoom(room).promise.catch(failed);
	}

	/**
	 * Attaches picked, pasted or recorded files to the open pane's draft
	 * (capability `embed:upload`), to go out when it is sent. Images start
	 * shrinking and losing their metadata right away, to the server's limits
	 * where it states them (`ext:media`); one that can't be readied, or that
	 * the server said it doesn't take, is taken back off with the reason.
	 */
	function stageFiles(picked: File[]): void {
		// Staging is local: a quiet reconnect takes files as it takes typing, and sending waits for the connection.
		if (!paneSteady || session.readOnly || !session.capabilities['embed:upload']) return;
		const limits = serverMedia(session.server).upload;
		const staged = picked.map((file): StagedFile => ({ id: `staged-${++stagedCount}`, file, prepared: prepareUpload(file, { limits }) }));
		for (const { id, prepared } of staged) {
			prepared.catch((cause: unknown) => {
				drafts.unstage(id);
				feedback.error(cause, 'Unable to attach the file');
			});
		}
		drafts.stage(staged);
		// The draft changed under the ask: Send asks again about what it mentions then.
		if (!mentionAsk?.busy) mentionAsk = undefined;
		composer?.focus();
	}

	/**
	 * Sends the draft with its staged files as upload embeds, with whatever is
	 * in the composer as the text; each file is written to the URL the server
	 * hands back, and the message shows it pending until then. A command
	 * takes them as arguments instead (§4.1). A failed send gives the draft
	 * back, files and all.
	 */
	/** `added`: whom the ask to add who it mentions added, which it mentions besides its chips (`sendMessage`). */
	async function sendFiles(added: readonly string[] = []): Promise<void> {
		if (!client || !paneRoom || !canCompose || !session.snapshot.capabilities['embed:upload']) return;
		const chat = client;
		const room = paneRoom;
		const roomId = room.id;
		const originKey = draftKey(roomId);
		const draft = drafts.text;
		const reply = drafts.reply;
		const staged = drafts.files;
		const action = composerAction(draft, { command: snapshot.capabilities.command, rooms: false });
		const command = action.kind === 'command';
		// `/emoji add` takes its image to the server's emoji limits (`ext.media.emoji`), not those it was staged to.
		const media = serverMedia(session.server);
		const limits = attachmentLimits(action, media);
		const refit = limits !== media.upload ? staged.map(({ file }) => prepareUpload(file, { limits })) : undefined;
		const text = action.kind === 'message' ? action.text : draft;
		const mentions = [...new Set([...composerMentions, ...added])];
		const dismissed = drafts.dismissed;
		const embeds = command ? [] : linkPreviews.embeds(text, dismissed);
		const options = { ...(reply ? { replyTo: reply } : {}), ...(mentions.length ? { mentions } : {}), ...(embeds.length ? { embeds } : {}) };
		clearComposer(roomId);
		chat.sendTyping(roomId, false);
		stopTyping();
		viewport.pin();
		composer?.focus();
		feedback.pending(staged.length === 1 ? `Uploading ${staged[0].title || staged[0].file.name || 'file'}…` : `Uploading ${staged.length} files…`);
		// A file that couldn't be readied was already taken off with its reason; the rest go.
		const readied = await Promise.allSettled(refit ?? staged.map(({ prepared }) => prepared));
		// Each goes out under the name it was given on the draft, if it was renamed.
		const files = readied.flatMap((result, index) => (result.status === 'fulfilled' ? [{ ...result.value, ...(staged[index].title ? { title: staged[index].title } : {}) }] : []));
		const kept = staged.filter((_, index) => readied[index].status === 'fulfilled');
		const restore = (back = kept) => {
			if (drafts.restore(originKey, draft, reply, back, dismissed)) composer?.focus();
		};
		// One `/emoji add` can't take is handed back with the draft, unsent, with the reason.
		const refused = refit && readied.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (refused) {
			feedback.error(refused.reason, 'Unable to attach the file');
			restore(staged);
			return;
		}
		if (client !== chat) {
			restore();
			return;
		}
		if (files.length === 0 && !text.trim()) return;
		const joining = command ? undefined : joinFirst(chat, room);
		const { sent, uploaded } = joining
			? (() => {
				const posted = joining.then(() => chat.sendFiles(roomId, text, files, 'markdown', options, command));
				return { sent: posted.then(({ sent }) => sent), uploaded: posted.then(({ uploaded }) => uploaded) };
			})()
			: chat.sendFiles(roomId, text, files, 'markdown', options, command);
		sent.catch((cause: unknown) => {
			if (command) {
				feedback.clear();
				chat.notify(roomId, cause instanceof Error && cause.message ? cause.message : 'The command failed');
			} else {
				feedback.error(cause, 'Unable to send the attachment');
			}
			restore();
		});
		uploaded.then(() => feedback.clear(), (cause: unknown) => {
			if (!command) feedback.error(cause, 'Upload failed');
		});
	}

	// A panel opening or shutting (not a drag, nor the window crossing into or out of the member list's column):
	// before the DOM changes, the timeline takes its final width for the slide.
	let lastTracks: { rooms: number; members: number; wide: boolean } | undefined;
	$effect.pre(() => {
		const tracks = { rooms: roomsTrack, members: membersTrack, wide: memberListWide };
		untrack(() => {
			const before = lastTracks;
			lastTracks = tracks;
			if (!before || !slidesReady || before.wide !== tracks.wide || sidebar.resizing || memberList.resizing) return;
			const change = before.rooms - tracks.rooms + before.members - tracks.members;
			if (change !== 0) viewport.prepareSlide(change);
		});
	});

	function toggleMemberList(): void {
		if (memberListWide) memberList.toggle();
		else memberListOverlay = !memberListOverlay;
	}

	/**
	 * Takes each snapshot as the client emits it, while what's in flight is still pending in it: a private room that
	 * arrives without this page asking for it (`ArrivalWatch`; nor joining it, as `pendingJoin` says) is one someone
	 * else added you to, and gets its banner.
	 */
	function noteArrivals(next: ClientSnapshot): void {
		const arrived = arrivals.next(next).filter((id) => id !== pendingJoin?.room);
		if (arrived.length) keepAdded([...addedRooms.filter((id) => !arrived.includes(id)), ...arrived]);
		// A room someone added you to counts its messages unread from your join, also those said while you were away;
		// being added alerts nothing by itself. Without capability `rooms`, a room appears joined when its first
		// message arrives: nobody added you.
		if (next.capabilities.rooms) for (const id of arrivals.added) if (id !== pendingJoin?.room) unread.addedTo(id);
	}

	/** Keeps the private rooms whose "You were added" banner shows, for this account on this device. */
	function keepAdded(rooms: string[]): void {
		addedRooms = rooms;
		saveAddedRooms(addedAccount, rooms);
	}

	/** Mutes, or unmutes, the room someone added you to (§4.5 `mute` with its `room_id`), from its banner. */
	async function muteAdded(roomId: string, mute: boolean): Promise<void> {
		if (!client) return;
		const chat = client;
		await addedTask.run('saving', () => chat.setMute(mute, roomId), { failed: (cause) => messageOf(cause, mute ? 'Unable to mute' : 'Unable to unmute') });
	}

	/** Mutes the open room or thread, or the room of an open thread (§4.5 `mute` with its `room_id`), for a while or until unmuted, or with `false` unmutes it. */
	function mutePane(until: PausedUntil | false, roomId: string): void {
		if (!client) return;
		client.setMute(until === false ? false : muteFor(until), roomId).catch((cause: unknown) => feedback.error(cause, until === false ? 'Unable to unmute' : 'Unable to mute'));
	}

	/**
	 * Opens a private room this page started or found: at once where it's listed and private, else once its
	 * `room_update` arrives, checked for `private: true` as a room created private is (§4.2.4). `problem` is what
	 * couldn't be done in it, such as someone who couldn't be added.
	 */
	function openPrivateRoom(roomId: string, problem?: string): void {
		arrivals.mine(roomId);
		const room = session.rooms.find((candidate) => candidate.id === roomId);
		if (room?.private) chooseRoom(room);
		else {
			pendingJoin = { room: roomId, private: true };
		}
		if (problem) feedback.error(problem);
	}

	// --- Rooms ---

	function joinRoom(roomId: string): void {
		if (!client) return;
		// Joining is a write where guests only read: they open the room through its history instead.
		if (session.readOnly) {
			openWithoutJoining(roomId);
			return;
		}
		pendingJoin = { room: roomId, private: false };
		feedback.track(client.joinRoom(roomId), 'Joining…');
	}

	/**
	 * Opens a listed room or thread without joining it, read through its
	 * history (§4.3): a room picked under Other Rooms (or reached with Alt+↑/↓),
	 * and anything a guest opens on a server whose guests only read. Join in its
	 * header, or posting there (`joinFirst`), joins it.
	 */
	function openWithoutJoining(roomId: string): void {
		if (!client || !client.viewRoom(roomId)) return;
		const room = session.rooms.find((candidate) => candidate.id === roomId);
		if (room?.parentRoomId !== undefined) openDestination(room.parentRoomId, roomId);
		else if (room) chooseRoom(room);
	}

	/** Leaves the open room or thread (capability `rooms`); the server removes it from the list. */
	function leavePane(): void {
		if (!client || !paneRoom) return;
		const leaving = paneRoom;
		// A private room isn't listed to join again: only a member can add you back, and the last to leave ends it.
		const again = leaving.parentRoomId !== undefined ? 'You can join it again from Other Threads under its room.'
			: !leaving.private ? 'You can join it again from Other Rooms.'
			: othersIn(leaving, session.you?.user_id).length ? 'It’s private: only someone in it can add you back.'
			: 'No one else is in it, so it ends when you leave.';
		if (!confirm(`Leave ${leaving.title}? ${again}`)) return;
		if (activeThread && activeRoom) backToRoom();
		feedback.track(client.leaveRoom(leaving.id), 'Leaving…');
	}

	/**
	 * Leaves a thread from its row in the sidebar, without asking: it only moves down to Other Threads, where
	 * Join brings it back. Its card stays in the room.
	 */
	function leaveThread(thread: string): void {
		if (!client) return;
		if (activeThread === thread && activeRoom) backToRoom();
		feedback.track(client.leaveRoom(thread), 'Leaving…');
	}

	/** Joins the thread open without joining (capability `rooms`): from then on it delivers live. */
	function joinPane(): void {
		if (!client || !paneRoom || paneRoom.joined) return;
		feedback.track(client.joinRoom(paneRoom.id), 'Joining…');
	}

	/**
	 * Posting needs no membership (§4.2.2), but a poster who hasn't joined
	 * doesn't receive the broadcast: a post in a room or thread read without
	 * joining joins it first, so the post and what follows arrive.
	 */
	function joinFirst(chat: ChatClient, room: RoomSnapshot): Promise<unknown> | undefined {
		if (room.joined || !session.canManageRooms) return undefined;
		return chat.joinRoom(room.id).promise;
	}

	/**
	 * A room mention in a message was clicked: open it. One you haven't joined opens to read without joining, as
	 * picking it under Other Rooms does, when the client can (it's listed, or was seen); else it's joined.
	 */
	function openMentionedRoom(roomId: string): void {
		const room = session.rooms.find((candidate) => candidate.id === roomId);
		if (!room) {
			if (client?.viewRoom(roomId)) openWithoutJoining(roomId);
			else if (session.canManageRooms) joinRoom(roomId);
			return;
		}
		if (room.parentRoomId !== undefined && session.rooms.some((candidate) => candidate.id === room.parentRoomId)) openDestination(room.parentRoomId, room.id);
		else chooseRoom(room);
	}

	function clearComposer(roomId: string): void {
		drafts.clear(draftKey(roomId));
	}

	function beginReply(event: MessageRecord): void {
		if (!canCompose || event.deleted) return;
		drafts.setReply(event.message_id);
		composer?.focus();
	}

	function cancelReply(): void {
		drafts.setReply(undefined);
		composer?.focus();
	}

	/**
	 * A message by ID in any room: a reply target (`reply_to` may cross rooms,
	 * such as a thread's first reply to the message it was started from).
	 * Visible rooms' timelines first, so this follows every snapshot; then
	 * anything else the client has stored.
	 */
	function resolveMessage(id: string): MessageRecord | undefined {
		return findMessage(session.rooms, id) ?? client?.message(id);
	}

	/** The message a link to this server names (Appendix A.4), for its card: where it is loaded here. Nothing is fetched to draw a card. */
	function linkedMessage(link: ApronLink): MessageRecord | undefined {
		return link.message ? resolveMessage(link.message) : undefined;
	}

	/** The rooms and threads listed to join, by `room_id`, for links' cards: made once per snapshot, not per link. */
	const listedRooms = $derived(new Map([...(session.directory ?? []), ...Object.values(session.threadDirectory).flat()].map((listing) => [listing.id, listing])));

	/** The room or thread a link to this server names, likewise: one joined, opened or listed here. */
	function linkedRoom(link: ApronLink): LinkedRoom | undefined {
		return link.room ? linkedRoomIn(session.rooms, listedRooms, link.room) : undefined;
	}

	function replyPreview(id: string): { name?: string; text: string } {
		const target = resolveMessage(id);
		if (!target) return { text: 'Message unavailable' };
		if (target.deleted) return { text: 'Message deleted' };
		return { name: senderName(target), text: messageSnippet(target) };
	}

	/**
	 * A message's reaction chips, from the timeline of the room it lives in: that room on its own (`session.room`), so
	 * a message drawn on screen isn't worked out again with each change in another room.
	 */
	function reactionsFor(event: MessageRecord): ReactionChip[] {
		const room = session.room(event.room_id);
		return reactionChips(room?.timeline.reactions[event.message_id], session.you?.user_id, event.deleted === true, (user) => directory.name(user), directory.emojiImage);
	}

	function react(event: MessageRecord, emoji: string): void {
		if (!client || !session.canReact || event.deleted) return;
		feedback.track(client.toggleReaction(event.message_id, emoji), 'Reacting…');
	}

	// --- Message rows ---

	/** The test ids interop finds a message's parts by. */
	const MESSAGE_TESTIDS: MessageTestids = { handle: 'sender-handle', reply: 'reply-reference', reactions: 'reactions', chip: 'reaction-chip', select: 'select-message', writing: 'message-writing', waiting: 'message-waiting', receipts: 'read-receipts' };

	/** What every row reads from, each field only where a row needs it. */
	const messageContext: MessageContext = {
		resolve: resolveMessage,
		linked: linkedMessage,
		linkedRoom,
		get server() {
			return client?.url;
		},
		get uploads() {
			return session.uploads;
		}
	};

	/** The record a row shows: the open pane's, else wherever it is. */
	function rowEvent(view: MessageView): MessageRecord | undefined {
		return view.id ? (paneRoom?.timeline.events[view.id] ?? resolveMessage(view.id)) : undefined;
	}

	/** Runs `action` on the row's record, if it is still there. */
	function onRow(action: (event: MessageRecord) => void): (view: MessageView) => void {
		return (view) => {
			const event = rowEvent(view);
			if (event) action(event);
		};
	}

	/** The picker the React action opened last, and on which message: it's open for that row while it is the open one. */
	let reactPick: { id: string; request: EmojiPickerRequest } | undefined;
	/**
	 * A row on show has its React picker open: the timeline's `ap-timeline-picking`, so the other rows don't take the
	 * hover look meanwhile. A class rather than `:has()` on the timeline, which the browser re-checks over every row
	 * on each hover change (each step of a wheel scroll under the pointer).
	 */
	let pickingRow = $derived(emojiPicker.current !== undefined && emojiPicker.current === reactPick?.request && shownTimeline.some((item) => item.kind === 'message' && item.event.message_id === reactPick?.id));

	/** One set of handlers for every row; each finds its message by the row's id. */
	const messageHandlers: MessageHandlers = {
		reply: onRow(beginReply),
		react: (view, emoji) => onRow((event) => react(event, emoji))(view),
		// React opens the full picker; a pick toggles that reaction, as a chip does.
		pick: (view, anchor) => onRow((event) => {
			const request: EmojiPickerRequest = { anchor, onpick: (emoji) => react(event, emoji), caption: { lead: `React to ${view.sender.name}`, text: messageSnippet(event) } };
			reactPick = { id: event.message_id, request };
			emojiPicker.toggle(request);
		})(view),
		picking: (view) => emojiPicker.current !== undefined && emojiPicker.current === reactPick?.request && reactPick.id === view.id,
		pickAnchor: emojiAnchor,
		// Who reacted, read from the current chips, so the open list follows changes.
		reactors: (view, emoji, anchor) => showReactors(anchor, emoji, () => {
			const event = rowEvent(view);
			return event ? reactionsFor(event) : [];
		}),
		edit: onRow((event) => (editingId = event.message_id)),
		delete: onRow(deleteMessage),
		startThread: onRow(startThread),
		copyLink: async (view) => {
			const event = rowEvent(view);
			return event ? copyMessageLink(event) : false;
		},
		// Touch's menu offers this, since its rows take no text selection: the text as written, Markdown and all.
		copyText: async (view) => {
			const text = rowEvent(view) ? textOf(rowEvent(view)!) : '';
			if (!text) return false;
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
		},
		select: (view, range) => {
			if (view.id) selection.toggle(view.id, selectableOrder, range);
		},
		beginSelect: onRow(beginSelect),
		removeReply: onRow(removeReply),
		removeEmbed: (view, props) => {
			const embed = sourceEmbed(props);
			if (embed) onRow((event) => removeEmbed(event, embed))(view);
		},
		openRoom: openMentionedRoom,
		// A user mention, or the sender's name or avatar, opens their profile card.
		openProfile: openProfileFrom,
		jump: jumpToMessage,
		code: decorateCode
	};

	// --- Reading ---

	/** Where a message shows: a thread's messages in the thread, a room's own in the room. */
	function destinationOf(target: MessageRecord): { room: string; thread?: string } | undefined {
		const rooms = session.rooms;
		const home = rooms.find((room) => room.id === target.room_id);
		if (!home) return undefined;
		if (home.parentRoomId !== undefined && rooms.some((room) => room.id === home.parentRoomId)) return { room: home.parentRoomId, thread: home.id };
		return { room: home.id };
	}

	/**
	 * Scrolls the timeline to a message and highlights it for a moment, first
	 * opening the room or thread it lives in (and loading a thread's history).
	 */
	async function jumpToMessage(id: string): Promise<void> {
		const target = resolveMessage(id);
		const destination = target ? destinationOf(target) : undefined;
		if (!destination) return;
		const opening = destination.room !== activeRoom?.id || destination.thread !== activeThread;
		if (opening) openDestination(destination.room, destination.thread);
		const node = await viewport.jumpTo(id, opening);
		if (!node) return;
		node.focus({ preventScroll: true });
		highlightedId = id;
		if (highlightTimer) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => (highlightedId = undefined), 1600);
	}

	/** Takes you to the oldest mention that arrived while you were reading back. */
	function jumpToMention(): void {
		const target = mentions.takeUnseen();
		if (target) void jumpToMessage(target);
		else viewport.jumpToLatest();
	}

	// --- The keyboard among the messages (lib/ui/message-focus.ts) ---

	/**
	 * Puts the keyboard on a message's row, in view, its toolbar showing as on hover: the least scroll that shows it
	 * whole, or for one taller than the pane (a picture or two), its top, where its sender and toolbar are.
	 */
	function focusMessage(row: HTMLElement): void {
		row.focus({ preventScroll: true });
		const list = viewport.messageScroll;
		row.scrollIntoView({ block: list && row.offsetHeight > list.clientHeight ? 'start' : 'nearest' });
	}

	/** ↑ in the empty composer: the keyboard goes to the newest message. False with none to go to. */
	function focusNewestMessage(): boolean {
		const list = viewport.messageScroll;
		const newest = list && messageRows(list).at(-1);
		if (!newest) return false;
		focusMessage(newest);
		return true;
	}

	/** How many rows fill the pane, for Page Up and Page Down (a measure taken only on the key). */
	function rowsPerPage(rows: HTMLElement[]): number {
		const pane = viewport.messageScroll?.getBoundingClientRect();
		if (!pane) return 1;
		return rows.filter((row) => {
			const box = row.getBoundingClientRect();
			return box.bottom > pane.top && box.top < pane.bottom;
		}).length - 1;
	}

	/** The last item of the timeline the keyboard was on, where Tab from outside comes back to; not state, only a memo. */
	let lastItem: HTMLElement | undefined;
	/** The latest key was Tab: a focus arriving in the timeline is Tab's, not a click's. */
	let tabbing = false;
	/** Where Shift+↑ ↓ began, which the selection runs from (Selection.extend). */
	let selectAnchor: string | undefined;

	/**
	 * Tab into the timeline (from the header, or Shift+Tab from the composer) lands on the item the keyboard was last on,
	 * else the newest message, rather than on the first or last of its links: the timeline is a single Tab stop.
	 */
	function timelineFocusin(event: FocusEvent): void {
		const target = event.target;
		const list = viewport.messageScroll;
		if (!(target instanceof HTMLElement) || !list) return;
		if (timelineItems(list).includes(target)) lastItem = target;
		const from = event.relatedTarget;
		if (!tabbing || (from instanceof Node && list.contains(from)) || target.closest('[data-testid="message-editor"]')) return;
		if (lastItem === target) return;
		const back = lastItem?.isConnected && list.contains(lastItem) ? lastItem : messageRows(list).at(-1);
		if (back && back !== target) focusMessage(back);
	}

	/**
	 * Shift+↑ or Shift+↓ on a message: select mode picks from where the run began to the message the keyboard moves to,
	 * the way a shift-click fills a range; stepping back gives them up again.
	 */
	function extendSelection(row: HTMLElement, step: 'previous' | 'next'): void {
		const list = viewport.messageScroll;
		if (!list || !paneRoom) return;
		const items = timelineItems(list);
		let next: HTMLElement | undefined = row;
		do next = stepMessage(items, next, step);
		while (next && !isMessageRow(next));
		const here = messages.find((event) => event.message_id === row.dataset.messageId);
		const there = next && messages.find((event) => event.message_id === next!.dataset.messageId);
		if (!here || !canSelect(here) || !next || !there || !canSelect(there)) return;
		if (!selection.active) {
			beginSelect(here);
			selectAnchor = here.message_id;
		} else if (!selectAnchor || !selection.current?.ids.includes(selectAnchor)) {
			// Select mode begun otherwise (`x`, a click): the run starts here.
			selectAnchor = here.message_id;
		}
		selection.extend(selectAnchor ?? here.message_id, there.message_id, selectableOrder);
		focusMessage(next);
	}

	/**
	 * Keys in the timeline (where text is written, the keys are the field's):
	 * - Tab and Shift+Tab go past it, a single stop.
	 * - On an item (a message, a notice, a thread's card): ↑ ↓, Home End and Page Up Page Down move to another, ↑ at the
	 *   oldest drawing or loading older ones as scrolling back does, ↓ at the newest going back to the composer, as
	 *   Escape does. Shift+↑ ↓ on a message select from there.
	 * - On a message: Enter goes into its toolbar, → into its links and buttons, where ← → go through them and Escape
	 *   back to the row. `x`, `r` and `e` are the row's own (Message.svelte).
	 */
	async function timelineKey(event: KeyboardEvent): Promise<void> {
		const target = event.target;
		const list = viewport.messageScroll;
		if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(target instanceof HTMLElement) || !list) return;
		if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-testid="message-editor"]')) return;
		if (event.key === 'Tab') {
			const out = tabbableOutside(list, !event.shiftKey);
			if (!out) return;
			event.preventDefault();
			out.focus();
			return;
		}
		const row = articleOf(target);
		// In a message's links and buttons.
		if (row && target !== row) {
			if (event.key === 'Escape') {
				event.preventDefault();
				row.focus();
			} else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey) {
				event.preventDefault();
				const controls = rowControls(row);
				const at = controls.indexOf(target);
				const to = event.key === 'ArrowRight' ? controls[at + 1] : at <= 0 ? row : controls[at - 1];
				to?.focus();
			}
			return;
		}
		if (!timelineItems(list).includes(target)) return;
		if (event.key === 'Escape') {
			// In select mode Escape ends it (windowKeydown); the composer is the selection bar then.
			if (selection.active) return;
			event.preventDefault();
			// Back to the composer; without one (a guest who only reads), off the messages.
			if (composer) composer.focus();
			else target.blur();
			return;
		}
		if (row && event.key === 'ArrowRight' && !event.shiftKey) {
			const first = rowControls(row)[0];
			if (!first) return;
			event.preventDefault();
			first.focus();
			return;
		}
		if (row && event.key === 'Enter') {
			if (selection.active) return;
			const action = row.querySelector<HTMLElement>('.ap-msg-actions button');
			if (!action) return;
			event.preventDefault();
			action.focus();
			return;
		}
		const step = MESSAGE_STEPS[event.key];
		if (!step) return;
		if (event.shiftKey) {
			if (!isMessageRow(target) || (step !== 'previous' && step !== 'next')) return;
			event.preventDefault();
			extendSelection(target, step);
			return;
		}
		event.preventDefault();
		const items = timelineItems(list);
		const next = stepMessage(items, target, step, step === 'pageUp' || step === 'pageDown' ? rowsPerPage(items) : 1);
		if (next) {
			focusMessage(next);
			return;
		}
		if (step === 'next' || step === 'last' || step === 'pageDown') {
			// At the newest: the composer is next, where there is one.
			composer?.focus();
			return;
		}
		// Past the oldest drawn: the rest of what's loaded first, then older pages, as scrolling back would.
		await viewport.showOlder();
		const older = stepMessage(timelineItems(list), target, 'previous');
		if (older && document.activeElement === target) focusMessage(older);
	}

	/**
	 * Sets `firstScreenDrawn` once the rooms are listed and the open pane (if any) has caught up, and a frame has painted
	 * that: the hidden panels draw their rows in a task of their own after it. A root of its own, gone once that's done,
	 * so the page's updates don't visit it after. Returns what stops it early.
	 */
	function watchFirstScreen(): () => void {
		const stop = $effect.root(() => {
			$effect(() => {
				if (session.starting || paneCatchingUp) return;
				let timer: ReturnType<typeof setTimeout> | undefined;
				let frame = requestAnimationFrame(() => {
					frame = 0;
					timer = setTimeout(() => {
						firstScreenDrawn = true;
						stop();
					});
				});
				return () => {
					if (frame) cancelAnimationFrame(frame);
					clearTimeout(timer);
				};
			});
		});
		return stop;
	}

	// --- Editing ---

	/**
	 * Any message in the open pane can be picked for a move (capability `edit`), anyone's:
	 * the server decides whose it lets you move, and a refusal moves none (MessageSelection.move).
	 */
	/** Anyone who can read may pick messages, to copy them as a log; moving them is offered only to who may edit. */
	function canSelect(event: MessageRecord): boolean {
		return !event.deleted && event.room_id === paneRoom?.id;
	}

	/** Whether a picked message is yours, which the server always lets you move. */
	function ownMessage(id: string): boolean {
		const event = resolveMessage(id);
		return event !== undefined && isOwn(event, session.you);
	}

	/** Whether you may move a picked message to a new thread: yours, or anyone's where `ext:permissions` grants `move_any`. */
	function movable(id: string): boolean {
		const event = resolveMessage(id);
		return event !== undefined && mayMove(event, session.you, yourPermissions(session.server, session.you).move_any);
	}

	/**
	 * Who comes along when picked messages move into a thread: each moved
	 * message's author not in it yet is added to it (§4.2.2), so they still
	 * see their messages. Only where this viewer may add people: with
	 * `add_members` in `you.ext.permissions` (or without that extension), or
	 * in a private room, whose members add people to it (§4.2.4).
	 */
	function moveAuthors(): MoveAuthors | undefined {
		if (!canChangeMembers || session.snapshot.memberChangesUnsupported) return undefined;
		if (!activeRoom?.private && !yourPermissions(session.server, session.you).add_members) return undefined;
		return {
			of: (id) => resolveMessage(id)?.from?.user_id,
			skip: (userId, room) => userId === session.you?.user_id || Boolean(session.rooms.find((other) => other.id === room)?.members?.some((member) => member.user_id === userId))
		};
	}

	/** What the toolbar offers: only what the server can do, and only on messages this viewer may change. */
	function capsFor(event: MessageRecord): MessageCaps {
		// Edits, moves and deletes are `message` requests: a reader who may not write makes none (`ext:permissions`).
		const own = session.canEdit && !session.readOnly && isOwn(event, session.you);
		return {
			reply: canCompose && !event.deleted,
			edit: own && !event.deleted,
			startThread: canStartThreads && canCompose && !event.deleted && !activeThread && event.room_id === activeRoom?.id,
			select: canSelect(event),
			removeReply: own && Boolean(event.reply_to),
			react: session.canReact && canCompose && !event.deleted,
			link: !event.deleted
		};
	}

	/**
	 * The edit ends, saved, cancelled or its message gone: the keyboard goes back to the message's row, where every
	 * edit opens from (its Edit, or `e`), once the editor's going has left it nowhere.
	 */
	function endEdit(): void {
		const id = editingId;
		editingId = undefined;
		if (id === undefined) return;
		void tick().then(() => {
			if (document.activeElement && document.activeElement !== document.body) return;
			document.querySelector<HTMLElement>(`article[data-message-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
		});
	}

	/** Saves an edit: the new text, and any embeds removed or renamed in the editor, together. */
	function saveEdit(event: MessageRecord, text: string, edits: EmbedEdits | undefined, mentions: string[]): void {
		if (!client || !session.canEdit) return;
		feedback.track(client.editMessage(event.message_id, text, undefined, edits, mentions), 'Saving edit…');
		endEdit();
	}

	function deleteMessage(event: MessageRecord): void {
		if (!client || !session.canEdit) return;
		if (!confirm('Delete this message? This cannot be undone.')) return;
		feedback.track(client.deleteMessage(event.message_id), 'Deleting message…');
	}

	/** The (x) on one of your embeds: saves the message without it. Hosted files and live output go with it, so those ask first. */
	function removeEmbed(event: MessageRecord, embed: Embed): void {
		if (!client || !session.canEdit) return;
		const question = removeEmbedQuestion(embed);
		if (question && !confirm(question)) return;
		feedback.track(client.removeEmbed(event.message_id, embed), 'Removing embed…');
	}

	function removeReply(event: MessageRecord): void {
		if (!client || !session.canEdit) return;
		feedback.track(client.setMessageReply(event.message_id, null), 'Removing reply reference…');
	}

	/**
	 * Asks for a new thread under the active room (capability `rooms`) in the
	 * NewThreadDialog; `createThread` makes it. Threads hang off a top-level
	 * room only.
	 */
	function askNewThread(start: Omit<NewThread, 'room'>): void {
		if (!client || !activeRoom || !canStartThreads || newThread) return;
		newThread = { room: { id: activeRoom.id, title: activeRoom.title, ...(activeRoom.private ? { private: true as const } : {}) }, ...start };
	}

	/** The + on the active room's row in the sidebar: a thread named from scratch. */
	function newThreadInRoom(room: RoomSnapshot): void {
		if (room.id === activeRoom?.id) askNewThread({ title: '', description: '' });
	}

	/**
	 * Start thread on a message: the dialog suggests the message's first line
	 * as the title and begins the description with the message quoted. Threads
	 * don't point at a message, so the link back is the thread's first reply:
	 * it opens with its composer replying to the message (`reply_to` crosses
	 * rooms, §3.5), which stays in the room where it was.
	 */
	function startThread(event: MessageRecord): void {
		if (!activeRoom || event.deleted) return;
		const id = event.message_id;
		// A thread already started from this message (here, or by anyone whose first reply points at it) opens instead.
		const existing = [startedThreads.get(id), threadStartedFrom(session.rooms, activeRoom.id, id)]
			.find((thread) => thread !== undefined && session.rooms.some((room) => room.id === thread));
		if (existing) {
			chooseThread(existing);
			return;
		}
		askNewThread({ title: threadTitleFor(event), description: threadDescriptionFor(event) ?? '', message: id });
	}

	/**
	 * Creates the thread the NewThreadDialog asked for (§4.2.4), the description as
	 * its `description`; it opens once its `room_update` has arrived. From
	 * select mode the selection then moves into it. A rejection is shown in the
	 * dialog, which stays open, so it only rejects while no thread exists.
	 */
	async function createThread(start: NewThread, thread: { title: string; description?: string }): Promise<void> {
		if (!client) throw new Error('Not connected');
		const roomId = start.room.id;
		if (start.moving) {
			const result = await selection.moveToNewThread(client, {
				parentRoomId: roomId,
				...thread,
				// Nothing moves out of a private room into a thread others can see.
				check: moveCheck(() => session.rooms, roomId),
				own: ownMessage,
				movable,
				authors: moveAuthors()
			});
			if (result.room !== undefined) {
				// Yours, though its record may come after the server named it.
				arrivals.mine(result.room);
				includeMembers(start.room, result.room);
			}
			if (result.moved) pendingOpen = { room: roomId, thread: result.room, moved: true };
			else if (result.room === undefined) throw result.error ?? new Error('No messages were moved');
			// The thread exists, so the dialog closes and says why nothing (or not everything) moved.
			else feedback.error(result.error, selection.current?.denied ? 'Some messages could not be moved' : 'No messages were moved');
			if (result.moved && result.unadded) feedback.error(unaddedNote(result.unadded));
			return;
		}
		const result = await client.createRoom({ parentRoomId: roomId, ...thread }).promise;
		if (typeof result.room_id !== 'string' || !result.room_id) throw new Error('Invalid room response');
		if (start.message !== undefined) startedThreads.set(start.message, result.room_id);
		arrivals.mine(result.room_id);
		includeMembers(start.room, result.room_id);
		pendingOpen = { room: roomId, thread: result.room_id, ...(start.message !== undefined ? { replyTo: start.message } : {}) };
	}

	/**
	 * A thread of a private room is private too, seen only by its members (§4.2.4): the room's other members are
	 * added to one started in it, so they see it and its replies, as they see the room's.
	 */
	function includeMembers(room: NewThread['room'], threadId: string): void {
		if (!client || !room.private) return;
		const members = session.rooms.find((candidate) => candidate.id === room.id);
		// A server may list only some of a large room's members (§4.2.1): only those are added.
		const listed = members?.members?.length ?? 0;
		const unlisted = members?.memberCount !== undefined && members.memberCount > listed;
		void addRoomMembers(client, threadId, members, session.you?.user_id).then((failed) => {
			const notes = [...(failed.length ? [couldNotAdd(failed, (userId) => directory.name({ user_id: userId }))] : []),
				...(unlisted ? [`Only the ${listed} members the server listed were added to the thread, of ${members!.memberCount}.`] : [])];
			if (notes.length) feedback.error(notes.join(' '));
		});
	}

	// --- Select mode ---

	function beginSelect(event: MessageRecord): void {
		if (!paneRoom || !canSelect(event)) return;
		editingId = undefined;
		composer?.reset();
		if (!mentionAsk?.busy) mentionAsk = undefined;
		selection.begin(paneRoom.id, event.message_id);
	}

	/**
	 * Moves the selection to a thread or back to the room (capability `edit`).
	 * The destination leaves the pane as it is.
	 */
	async function moveSelection(target: string): Promise<void> {
		if (!client || !paneRoom || !session.canEdit) return;
		// Back to the room, everyone is there already.
		const result = await selection.move(client, target, ownMessage, target === activeRoom?.id ? undefined : moveAuthors());
		if (!result.moved && result.error !== undefined) feedback.error(result.error, selection.current?.denied ? 'Some messages could not be moved' : 'No messages were moved');
		else if (result.unadded) feedback.error(unaddedNote(result.unadded));
	}

	/**
	 * Copies Markdown as plain text and, where the browser takes it, as HTML too
	 * (`messageLogHtml`), so a rich editor pastes it formatted, images and all.
	 */
	async function copyRich(markdown: string): Promise<void> {
		if (typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) return navigator.clipboard.writeText(markdown);
		const item = new ClipboardItem({
			'text/plain': new Blob([markdown], { type: 'text/plain' }),
			'text/html': new Blob([messageLogHtml(markdown)], { type: 'text/html' })
		});
		try {
			await navigator.clipboard.write([item]);
		} catch {
			await navigator.clipboard.writeText(markdown);
		}
	}

	/** "Copy to clipboard" in select mode: the picked messages, in timeline order, as Markdown (`messageLog`). Once copied, select mode ends. */
	async function copySelectionLog(): Promise<boolean> {
		const picked = messages.filter((event) => selection.has(event.message_id));
		if (!picked.length) return false;
		try {
			const reactions = (event: MessageRecord) => session.rooms.find((room) => room.id === event.room_id)?.timeline.reactions[event.message_id];
			await copyRich(messageLog(picked, { lookup: resolveMessage, reactions, order: selectableOrder }));
			selection.cancel();
			composer?.focus();
			return true;
		} catch {
			feedback.error('Unable to copy the messages');
			return false;
		}
	}

	/** The messages moved, but some of their authors weren't added to the thread: how many, and the server's first reason. */
	function unaddedNote(unadded: { failed: number; total: number; error: unknown }): string {
		const who = unadded.failed === unadded.total ? (unadded.total === 1 ? 'the author' : 'the authors') : `${unadded.failed} of ${unadded.total} authors`;
		const reason = unadded.error instanceof Error && unadded.error.message ? `: ${unadded.error.message}` : '';
		return `Moved, but ${who} couldn’t be added to the thread${reason}`;
	}

	/**
	 * "New thread" in select mode (capabilities `edit` and `rooms`): the
	 * NewThreadDialog suggests a title from the earliest selected message, and
	 * the selection moves into the thread once it exists. A selection that
	 * can't all move is refused before anything is asked or created.
	 */
	function newThreadFromSelection(): void {
		if (!paneRoom || !session.canEdit) return;
		const unmovable = selection.checkMovable(movable);
		if (unmovable) {
			feedback.error(unmovable);
			return;
		}
		selection.menuOpen = false;
		const first = selection.earliest(messages.map((event) => event.message_id));
		askNewThread({ title: threadTitleFor(first !== undefined ? resolveMessage(first) : undefined), description: '', moving: selection.ids.length });
	}

	/** Escape leaves select mode, as it leaves the thread menu. */
	/**
	 * Files pasted while focus is outside any field (on the timeline, say)
	 * attach to the draft, as they would pasted into the composer.
	 */
	function windowPaste(event: ClipboardEvent): void {
		if (event.defaultPrevented || !canAttach) return;
		if (inField(keyOrigin(event))) return;
		const files = pastedFiles(event.clipboardData);
		if (!files.length) return;
		event.preventDefault();
		stageFiles(files);
	}

	/** A file dropped anywhere else is refused, rather than opening in place of the app. */
	function refuseDrop(event: DragEvent): void {
		if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
	}

	/** A modal dialog is open, such as Preferences or a form: a shortcut opens no other over it. */
	function modalOpen(): boolean {
		try {
			return document.querySelector('dialog:modal') !== null;
		} catch {
			// A browser without `:modal`.
			return false;
		}
	}

	/**
	 * What an event happened on: inside a shadow root (emoji-mart's picker), the element there, not its host, which
	 * the event's `target` names once it is out of the shadow root, and which is no field.
	 */
	function keyOrigin(event: Event): EventTarget | null {
		return event.composedPath()[0] ?? event.target;
	}

	/** Where text is written, whose keys are its own: `?` there is a character. */
	function inField(target: EventTarget | null): boolean {
		return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null);
	}

	/** `?` outside a field, or Ctrl+/ (⌘/ on a Mac) anywhere: the key that shows the keyboard shortcuts. */
	function shortcutsKey(event: KeyboardEvent): boolean {
		if (event.altKey || event.isComposing) return false;
		// With Shift too: on many layouts (German, Nordic, Spanish) `/` is Shift+7.
		if (event.ctrlKey || event.metaKey) return event.key === '/';
		return event.key === '?' && !inField(keyOrigin(event));
	}

	function windowKeydown(event: KeyboardEvent): void {
		tabbing = event.key === 'Tab';
		// ↑ or ↓ with the keyboard nowhere (a guest who only reads has no composer to go up from, and the page starts
		// with nothing focused): onto the newest message, and from there the timeline's keys (timelineKey).
		if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (event.target === document.body || event.target === document.documentElement) &&
			!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.defaultPrevented && !modalOpen()) {
			if (focusNewestMessage()) event.preventDefault();
			return;
		}
		// The keyboard shortcuts, signed in, from anywhere on the page but another dialog (lib/ui/shortcuts.ts lists them).
		// The key is read first, so typing calls nothing more here.
		if ((event.key === '?' || event.key === '/') && client && !connectOpen && !event.defaultPrevented && shortcutsKey(event) && !modalOpen()) {
			event.preventDefault();
			shortcutsOpen = true;
			return;
		}
		// Alt+↑/↓ (⌥ on a Mac): the room or thread above or below the open one in the rooms list, and with Shift the
		// room, past any threads, from anywhere but a dialog or a field other than the composer. On a room's row Alt+↑/↓
		// moves it instead: the Sidebar's reorderKey takes it first. A room listed to join opens to read, as a click does.
		// With nowhere to go (an end of the list), the key is the field's or the page's as usual.
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.ctrlKey && !event.metaKey && !event.defaultPrevented && client && !connectOpen && !modalOpen()) {
			const origin = keyOrigin(event);
			if (inField(origin) && !(origin as HTMLElement).closest('#message-input')) return;
			const row = nextRoomRow(document.querySelector('.ap-shell-side') ?? document, event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
			if (!row) return;
			event.preventDefault();
			row.click();
			return;
		}
		// Ctrl+F (⌘F on a Mac) searches local history's messages, and Ctrl+K (⌘K) its rooms and threads, from anywhere on the
		// page but another dialog; there, and before signing in, the browser's keys are its own as usual. In search,
		// either switches to its mode (SearchDialog).
		if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'f' || event.key.toLowerCase() === 'k') && canSearch && !modalOpen()) {
			event.preventDefault();
			searchMode = event.key.toLowerCase() === 'k' ? 'rooms' : 'messages';
			return;
		}
		// Escape in a dialog (the NewThreadDialog, the keyboard shortcuts) closes it and keeps the selection.
		if (event.key !== 'Escape' || !selection.active || newThread || modalOpen()) return;
		if (selection.menuOpen) {
			selection.menuOpen = false;
			return;
		}
		selection.cancel();
		composer?.focus();
	}
</script>

<svelte:window onkeydown={windowKeydown} onpointerdowncapture={() => (tabbing = false)} onpaste={windowPaste} ondragover={refuseDrop} ondrop={refuseDrop} onfocus={() => { presence.focus(); refreshNotificationPermission(); }} onblur={() => presence.blur()} />
<svelte:document onclick={mediaAskClick} onvisibilitychange={() => { presence.visibilityChanged(); refreshNotificationPermission(); if (document.visibilityState === 'hidden') { keepView(); void historyKeeper?.flush(); } }} />

<svelte:head>
	<title>{tabTitle(unreadAlerting, presence.titleFlash)}</title>
	<meta name="description" content="Apron, a chat frontend for the Apron Chat Protocol." />
	<!-- Link previews. og.png is apron.chat's `npm run screenshot -- og`; absolute, as crawlers require. -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Apron" />
	<meta property="og:title" content="Apron" />
	<meta property="og:description" content="Apron, a chat frontend for the Apron Chat Protocol." />
	<meta property="og:url" content="https://web.apron.chat/" />
	<meta property="og:image" content="https://web.apron.chat/og.png" />
	<meta property="og:image:width" content="2400" />
	<meta property="og:image:height" content="1260" />
	<meta property="og:image:alt" content="The Apron web client: an engineering room with a mention, a replied-to message, reactions and a benchmark in a terminal, beside rooms, a thread, direct messages and members." />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{#if client && links.asked && signInLinkDialog.component}
	{@const SignInLinkDialog = signInLinkDialog.component}
	<!-- Signed in here, guests too, where a link can add a way in (`addAs`): the link may have been sent for that. -->
	<SignInLinkDialog
		link={links.asked}
		current={{
			url: client.url, keptSession: Boolean(snapshot.keptSession),
			...(links.asked.server && links.asked.server !== client.url ? { targetKeptSession: client.keptSessionFor(links.asked.server) } : {}),
			...(snapshot.passkeySession && session.you ? { signedInAs: session.you.name ? `${withoutBidiOverrides(session.you.name)} (@${session.you.user_id})` : `@${session.you.user_id}` } : {}),
			...(snapshot.authenticated && snapshot.you && snapshot.server?.auth.some((scheme) => scheme === 'email' || scheme === 'external') ? { addAs: snapshot.you.name ? `${withoutBidiOverrides(snapshot.you.name)} (@${snapshot.you.user_id})` : `@${snapshot.you.user_id}` } : {})
		}}
		onconfirm={() => links.confirm()} onadd={() => links.addAsked()} oncancel={() => links.cancel()}
	/>
{/if}
{#if !client}
	<AppShell viewport />
{:else if connectOpen}
	<ConnectScreen
		{client} {session} bind:serverInput bind:displayName {passkeyUnavailable} {recentServers}
		canCancel={!disconnected && (session.rooms.length > 0 || session.ready || offeringLink)} initialScheme={connectScheme}
		initialError={links.failure?.error} initialChoosing={connectChoosing} linked={offeringLink && linked ? { server: linked.server, room: linked.room } : undefined}
		onconnect={leaveBackend} onconnected={connected} oncancel={() => { connectOpen = false; offeringLink = false; if (client) serverInput = client.url; }} onsignout={signedOut}
	/>
{:else}
<!-- A message row's embed, through the app's media gates; and the row being edited, in the editor loaded for it. -->
{#snippet messageEmbed(item: MessageEmbed)}{@const embed = sourceEmbed(item.embed)}{#if embed}<EmbedItem {embed} upload={item.upload} detail={item.detail} />{/if}{/snippet}
{#snippet editMessage(view: MessageView)}
	{@const MessageEditor = messageEditor.component}
	{@const event = rowEvent(view)}
	{#if MessageEditor && event}<MessageEditor text={textOf(event)} embeds={embedsOf(event)} uploads={session.uploads} mentions={event.body?.mentions} {people} rooms={roomSuggestions} onsave={(text, edits, mentions) => saveEdit(event, text, edits, mentions)} oncancel={endEdit} onmention={() => { if (!paneRoom?.joined) listMembers(MEMBERS_FRESH_MS); }} />{/if}
{/snippet}
<!-- The pane's history waiting as the server asked, where its messages will appear: it loads by itself at zero. -->
{#snippet historyNotice()}{#if historyWait}<RateLimitNotice scope="history" until={historyWait.until} />{/if}{/snippet}
{#snippet membersToggle()}<PanelToggle bind:this={memberListToggle} side="right" panel="member list" open={memberListOpen} ontoggle={toggleMemberList} />{/snippet}
<!-- Kept through a drag that collapses the list, so the drag still ends on it. -->
<!-- Kept while shut (hidden), so its border slides with the list's. -->
{#snippet membersHandle()}<SidebarHandle layout={memberList} name="member list" oncollapse={() => memberListToggle?.focus()} />{/snippet}
<AppShell
	viewport
	slides={slidesReady}
	sideCollapsed={sidebar.collapsed}
	resizing={sidebar.resizing || memberList.resizing}
	membersOpen={memberListOpen}
	membersWide={memberListWide}
	pane={mobilePane}
	peek={narrow && activeRoom !== undefined}
	onpeek={closeRooms}
	sideWidth={sidebar.width}
	membersWidth={memberList.width}
	mainLabel="Conversation"
	mainAttach={dropFiles}
	membersToggle={memberListWide ? membersToggle : undefined}
	membersHandle={memberListWide ? membersHandle : undefined}
>
	{#snippet sideToggle()}<PanelToggle side="left" panel="rooms" open={!sidebar.collapsed} ontoggle={() => sidebar.toggle()} />{/snippet}
	{#snippet side()}
		<Sidebar
			drawRooms={sideDrawn} client={client!} {session} {backendLabel} serverLook={currentLook} serverAddress={client?.url} account={addedAccount} order={roomOrder} threads={listedThreads} {activeThread} mentions={mentions.byRoom} unread={unread.byRoom} bind:displayName {passkeyUnavailable}
			notificationsEnabled={notificationsActive} notificationsSupported={notificationState !== 'unsupported'} notificationPermission={notificationState} notifyScopes={notifyScopes} onnotifications={toggleNotifications} onnotifyscopes={setNotifyScopes} ontestnotifications={testNotifications}
			webPush={webPushKey(session.server) ? { supported: webPushAvailable, homeScreen: !webPushAvailable && needsHomeScreen(), enabled: webPushActive && !webPushHeldBy, ...(webPushHeldBy ? { heldBy: webPushHeldBy } : {}), ...(webPushServerKey ? {} : { signIn: true }), offered: webPushOffered, installable: canOfferInstall(installPrompt), ...(webPushError && webPushServerKey ? { error: webPushError } : {}) } : undefined} onwebpush={pushHere} oninstallapp={installApp}
			pause={canPause ? { ...(pausedUntil !== undefined && isPaused(pausedUntil) ? { until: pausedUntil } : {}) } : undefined} onpause={pauseNotifications} onresume={() => client?.setMute(false) ?? Promise.resolve()}
			onsignin={previewMode ? undefined : (name, scheme) => openConnect(scheme ? { scheme, name } : { signIn: true, name })}
			returnTo={activeRoom ? (activeThread ? threadTitle(activeThread) : activeRoom.title) : undefined} onreturn={closeRooms}
			onroom={chooseRoom} onthread={chooseThread} onopenthread={openThreadCard} onjoin={joinRoom} onopenroom={openWithoutJoining} onleavethread={leaveThread} oncreateroom={(roomId, options) => (pendingJoin = { room: roomId, private: options.private })} onnewthread={newThreadInRoom} onsignout={signedOut} keptHistory={historyKeeper}
			onnewprivate={canStartPrivate ? () => (newPrivateOpen = true) : undefined}
		/>
	{/snippet}
	{#snippet sideHandle()}<SidebarHandle layout={sidebar} />{/snippet}
	<!-- The first-mention offer, pointing at Preferences while the rooms list (and its gear) shows; above the composer otherwise. -->
	{#snippet nudge()}
		{#if notifyOffer}<NotifyPrompt {...notifyOffer} whenClosed={webPushAvailable && Boolean(webPushServerKey)} pointer onaccept={acceptNotifyOffer} ondecline={declineNotifyOffer} />
		{:else if installOffer && installNudge.component}{@const InstallPrompt = installNudge.component}<InstallPrompt way={installOffer} alerts={installAlerts} oninstall={installApp} ondecline={declineInstallOffer} />{/if}
	{/snippet}

	{#snippet main()}
		{#if dropping}<DropZone />{/if}
		{#if activeRoom}
			<RoomHeader
				room={activeRoom}
				pane={paneRoom ?? activeRoom}
				showTopic={!pinnedDescription}
				ondescription={descriptionPutAway ? () => { if (editTarget) hiddenDescriptions = showDescription(hiddenDescriptions, draftKey(editTarget.id)); } : undefined}
				threadTitle={activeThread ? threadTitle(activeThread) : undefined}
				typing={typingNames}
				replyCount={activeThread ? threadReplyCount : undefined}
				moreReplies={Boolean(activeThread && threadRoom?.olderAvailable)}
				waiting={Boolean(historyWait)}
				updating={updatingShown && !checkingShown}
				canEdit={canEditPane}
				editDisabled={!paneReady}
				canLeave={session.canManageRooms && !session.readOnly && Boolean(paneRoom?.joined)}
				canJoin={session.canManageRooms && !session.readOnly && Boolean(paneRoom) && !paneRoom?.joined}
				{memberListOpen}
				memberListToggle={!memberListWide}
				{unreadElsewhere}
				{mentionsElsewhere}
				onsearch={canSearch ? () => (searchMode = 'messages') : undefined} {searchHint} onshortcuts={searchHint ? () => (shortcutsOpen = true) : undefined}
				onback={openRooms} onroom={backToRoom} onedit={() => (roomEditorOpen = true)} onleave={leavePane} oncopylink={copyPaneLink} onjoin={joinPane} onmemberlist={toggleMemberList}
				onmute={canMuteRoom ? mutePane : undefined}
			/>
			{#if roomEditorOpen && editTarget && roomEditor.component}
				{@const RoomEditor = roomEditor.component}
				{#key editTarget.id}
					<RoomEditor client={client!} room={editTarget} thread={Boolean(activeThread)} enabled={canCompose && session.canManageRooms} onclose={() => (roomEditorOpen = false)} />
				{/key}
			{/if}

			<ConnectionNotice {session} onretry={signInAgain} />
			{#if activeThread && !activeThreadEntry}
				<div class="ap-shell-banner">
					<StatusBanner tone="danger">
						This thread is no longer available on the server.
						{#snippet action()}<button class="ap-btn ap-btn-sm" type="button" onclick={backToRoom}>Back to room</button>{/snippet}
					</StatusBanner>
				</div>
			{/if}

			{#if addedHere && activeRoom}
				{@const added = activeRoom}
				<AddedBanner
					testid="added-banner" busy={addedTask.busy || !paneReady} error={addedTask.note} muted={added.mutedUntil !== undefined}
					onmute={canMuteRoom ? () => muteAdded(added.id, true) : undefined} onunmute={canMuteRoom ? () => muteAdded(added.id, false) : undefined}
					onleave={session.canManageRooms && !session.readOnly ? leavePane : undefined} ondismiss={() => keepAdded(addedRooms.filter((id) => id !== added.id))}
				/>
			{/if}

			{#if pinnedDescription}
				{@const pinned = pinnedDescription}
				{#key pinned.id}
					<ThreadDescription description={pinned.description} thread={Boolean(activeThread)} onopenroom={openMentionedRoom} ondismiss={() => (hiddenDescriptions = hideDescription(hiddenDescriptions, draftKey(pinned.id), pinned.description))} />
				{/key}
			{/if}

			<!-- Outside the log, so it's announced once as a status rather than as an entry each time older messages load. -->
			{#if olderLoading}<TimelineLoading top label={activeThread ? 'Loading earlier replies…' : 'Loading earlier messages…'} />{/if}
			<!-- The log's rows take the keyboard (timelineKey): its keys move between them. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class={['ap-timeline', pickingRow && 'ap-timeline-picking']} bind:this={viewport.messageScroll} onscroll={trackScroll} onkeydown={timelineKey} onfocusin={timelineFocusin} {@attach markFirstMessages} data-testid="message-list" role="log" aria-live="polite" aria-label={`${activeThread ? threadTitle(activeThread) : activeRoom.title} messages`}>
				<FloatingDayPill label={viewport.floatingDay.label} shown={viewport.floatingDay.shown && !olderLoading} testid="floating-day" />
				{#if session.showReconnectDivider}
					<TimelineDivider kind="gap" testid="reconnect-divider" />
				{/if}
				<!-- No messages yet: placeholders, not thread cards on their own. -->
				{#if (messages.length === 0 || paneHeldBack) && paneCatchingUp}
					<TimelineLoading label={activeThread ? 'Loading replies…' : 'Loading messages…'} rows={activeThread ? 3 : 6} notice={historyWait ? historyNotice : undefined} />
				{:else if timeline.length === 0 && !privateIntro}
					<EmptyState title={activeThread ? 'No replies yet' : 'Nothing here yet'} detail={activeThread ? 'Reply below to continue the thread.' : `Start the conversation in ${activeRoom.title}.`} />
				{:else}
					{#if privateIntro}
						<PrivateIntro {...privateIntro} testid="private-intro" />
					{/if}
					{#each shownTimeline as item (item.key)}
						{#if item.kind === 'date'}
							<TimelineDivider label={item.label} sticky={false} />
						{:else if item.kind === 'thread'}
							<ThreadCard entry={item.entry} unread={unread.byRoom[item.entry.id]} mentions={mentions.byRoom[item.entry.id]} onopen={() => openThreadCard(item.entry.id)} />
						{:else if item.kind === 'notice'}
							<NoticeLine notice={item.notice} onopenroom={openMentionedRoom} />
						{:else if item.kind === 'members'}
							<MembershipLine joined={item.joined} left={item.left} logId={item.logId} />
						{:else if item.kind === 'renamed'}
							{@const what = activeThread ? 'Thread' : 'Room'}
							<SystemLine timestamp={idMillis(item.logId)} timelineItem testid={activeThread ? 'thread-renamed' : 'room-renamed'}>{#if item.title}{what} renamed to <span class="ap-msg-text">“{item.title}”</span>{:else}{what} name cleared{/if}</SystemLine>
						{:else}
							{@const event = item.event}
							{#if event.message_id === viewport.newDividerAt}
								<TimelineDivider kind="new" testid="new-divider" />
							{/if}
							<TimelineMessage
								row={() => messageView(item.event, {
									grouped: item.grouped,
									reactions: reactionsFor(item.event),
									mention: mentionsMe(item.event, session.you),
									pinged: mentions.pinged.includes(item.event.message_id),
									highlighted: highlightedId === item.event.message_id,
									selecting: selection.active,
									selected: selection.has(item.event.message_id),
									editing: editingId === item.event.message_id,
									caps: capsFor(item.event),
									seenBy: receipts.get(item.event.message_id)
								}, messageContext)}
								on={messageHandlers}
								testids={MESSAGE_TESTIDS}
								editor={(view) => (view.editing && messageEditor.component ? editMessage : undefined)}
								embed={messageEmbed}
							/>
						{/if}
					{/each}
				{/if}
			</div>

			{#if timeline.length > 0 && !viewport.latestVisible}
				<JumpBar count={viewport.unseenCount} mentions={mentions.unseen.length} onjump={() => viewport.jumpToLatest()} onjumpmention={jumpToMention} />
			{/if}

			<div class="ap-shell-nudge-inline" aria-live="polite">
				{#if notifyOffer}<NotifyPrompt {...notifyOffer} whenClosed={webPushAvailable && Boolean(webPushServerKey)} onaccept={acceptNotifyOffer} ondecline={declineNotifyOffer} />
				{:else if installOffer && installNudge.component}{@const InstallPrompt = installNudge.component}<InstallPrompt way={installOffer} alerts={installAlerts} oninstall={installApp} ondecline={declineInstallOffer} />{/if}
			</div>
			<TypingIndicator names={typingNames} class="ap-shell-typing" />
			<!-- Floats just above the composer, in the gap under the last message, rather than taking a line: nothing moves. -->
			{#if (checkingShown || historyWait) && timeline.length > 0}<TimelineLoading float label={quietReconnect ? statusLabel(snapshot, session.stalled) : activeThread ? 'Checking for new replies…' : 'Checking for new messages…'} notice={historyWait ? historyNotice : undefined} />{/if}
			<!-- A wait the server asked for on sending or uploads, above the composer it holds back. -->
			{#if (sendNotice || uploadNotice) && !selection.active && !session.readOnly}
				<div class="ap-shell-waits">
					{#if sendNotice}
						{@const wait = sendNotice}
						<RateLimitNotice scope="message" until={wait.until} ondismiss={() => (dismissedSendWait = wait.until)} />
					{/if}
					{#if uploadNotice}
						{@const wait = uploadNotice}
						<RateLimitNotice scope="upload" until={wait.until} ondismiss={() => (dismissedUploadWait = wait.until)} />
					{/if}
				</div>
			{/if}

			{#if selection.active}
				{#if selectionBar.component}
					{@const SelectionBar = selectionBar.component}
					<SelectionBar
						{selection} threads={canMoveSelection ? selectThreads : []} parentRoom={canMoveSelection && activeThread ? activeRoom.id : undefined} canCreateThread={canMoveSelection && canStartThreads}
						onmove={(room) => moveSelection(room)} onnewthread={newThreadFromSelection} onfill={() => selection.fillBetween(selectableOrder)} oncopy={copySelectionLog}
						oncancel={() => { selection.cancel(); composer?.focus(); }}
					/>
				{/if}
			{:else if session.readOnly}
				<ReadOnlyBar guest={!session.passkeySession} {passkeyUnavailable} archive={archiveNote} onsignin={() => openConnect({ signIn: true })} />
			{:else}
				<!--
					The draft Send held back, for mentioning people who aren't here: add them first, or send it as it is. Here,
					not beside the timeline's floating notices, which a scroll redraws (perf budget: scroll-timeline). A live
					region that stays, so the ask is read out as it arrives while the focus stays in the composer.
				-->
				<div class="ap-shell-ask" aria-live="polite">
					{#if mentionAsk && mentionAsk.roomId === paneRoom?.id && mentionAddNudge.component}
						{@const MentionAddPrompt = mentionAddNudge.component}
						<MentionAddPrompt
							names={mentionAsk.userIds.map((userId) => directory.name({ user_id: userId }))} place={activeThread ? threadTitle(activeThread) : activeRoom.title} thread={Boolean(activeThread)}
							busy={mentionAsk.busy} onadd={() => void addMentionedAndSend()} onsend={() => { sendMessage(true); composer?.focus(); }} oncancel={() => { dismissMentionAsk(); composer?.focus(); }}
						/>
					{/if}
				</div>
				<Composer
					bind:this={composer}
					bind:expanded={composerExpanded}
					bind:value={drafts.text}
					bind:mentions={composerMentions}
					bind:dismissed={drafts.dismissed}
					placeholder={activeThread ? `Reply in ${threadTitle(activeThread)}` : `Message ${activeRoom.title}`}
					disabled={!paneSteady || session.readOnly}
					holdSend={!canCompose || (mentionAsk?.busy === true && mentionAsk.roomId === paneRoom?.id)}
					canUpload={session.capabilities['embed:upload'] && !composingLive}
					live={composingLive}
					uploadLimits={serverMedia(session.server).upload}
					canCommand={session.capabilities.command}
					{people}
					rooms={roomSuggestions}
					reply={drafts.reply ? replyPreview(drafts.reply) : undefined}
					oninput={composerInput} onsend={() => sendMessage()} files={drafts.files} onfiles={stageFiles} onunstage={(id) => { drafts.unstage(id); if (!mentionAsk?.busy) mentionAsk = undefined; }} onrename={(id, title) => drafts.rename(id, title)} oncancelreply={cancelReply} onescape={dismissMentionAsk} onup={focusNewestMessage}
					onmention={() => { if (!paneRoom?.joined) listMembers(MEMBERS_FRESH_MS); }}
					waitUntil={composerWait}
				/>
			{/if}
		{:else}
			<NoRoom {session} onconnect={() => openConnect()} />
		{/if}
	{/snippet}
	{#snippet members()}
		<MemberListSidebar {client} {session} room={paneRoom} open={memberListOpen} drawRows={memberRowsDrawn} canChange={canChangeMembers} canAdd={canAddMembers} canMessage={canStartPrivate} onnamed={(roomId) => arrivals.mine(roomId)} onopenroom={openPrivateRoom} />
	{/snippet}
	<!--
		Outside the conversation pane, which a phone hides while the room list shows: a modal there doesn't render,
		so the + on a room's row would open nothing. It floats over whichever pane is up; the new thread opens in the
		conversation pane once it exists.
	-->
	{#if newThread && newThreadDialog.component}
		{@const start = newThread}
		{@const NewThreadDialog = newThreadDialog.component}
		{#key start}
			<NewThreadDialog room={start.room} title={start.title} description={start.description} moving={start.moving}
				enabled={canStartThreads && canCompose && (!start.moving || session.canEdit)}
				oncreate={(thread) => createThread(start, thread)} onclose={() => (newThread = undefined)} />
		{/key}
	{/if}
	{#if searchMode && client && searchDialog.component}
		{@const SearchDialog = searchDialog.component}
		<SearchDialog
			{client} mode={searchMode} keeper={sessionKeeper()} rooms={session.rooms} listed={snapshot.directory} threadsListed={snapshot.threadDirectory} unread={unread.byRoom} mentions={mentions.byRoom}
			canList={session.canManageRooms} {roomSuggestions} initial={paneRoom ? `room:#${paneRoom.id} ` : ''} note={searchNote()} keys={searchKeys}
			onopen={openFound} onopenroom={openSwitched} kept={historySettings.title} onhistory={showHistoryPreferences} onclose={() => (searchMode = undefined)}
		/>
	{/if}
	{#if shortcutsOpen && shortcutsDialog.component}
		{@const ShortcutsDialog = shortcutsDialog.component}
		<ShortcutsDialog onclose={() => (shortcutsOpen = false)} />
	{/if}
	{#if newPrivateOpen && newPrivateDialog.component}
		{@const NewPrivateDialog = newPrivateDialog.component}
		<NewPrivateDialog client={client!} {session} enabled={canStartPrivate} onnamed={(roomId) => arrivals.mine(roomId)} onopen={openPrivateRoom} onclose={() => (newPrivateOpen = false)} />
	{/if}
	<!--
		Popovers over the whole page, outside the member list: they open from messages too, and must show while it's shut.
		Each loaded on demand and mounted once first opened; the state that opens it is here from the start, and one
		opened before its code has come lets go on a press elsewhere or Escape rather than opening late (`Lazy.once`).
	-->
	{#if serverPaneHost.once(Boolean(serverPane.anchor), () => serverPane.close(), serverPane.anchor)}
		{@const ServerPane = serverPaneHost.component!}
		<ServerPane {client} {session} onnewserver={previewMode ? undefined : () => openConnect()} ondisconnect={previewMode ? undefined : disconnect} />
	{/if}
	{#if profileCardHost.once(Boolean(profileCard.current), () => profileCard.close(), profileCard.current?.anchor)}
		{@const ProfileCard = profileCardHost.component!}
		<ProfileCard {client} {session} room={paneRoom} canChange={canAddMembers} canMention={Boolean(composer) && canCompose && !selection.active} canMessage={canStartPrivate} onmention={(userId) => composer?.mention(userId)} onnamed={(roomId) => arrivals.mine(roomId)} onopenroom={openPrivateRoom} />
	{/if}
	{#if reactorsPopover.once(Boolean(reactorsList.current), () => reactorsList.close(), reactorsList.current?.anchor)}{@const ReactorsPopover = reactorsPopover.component!}<ReactorsPopover />{/if}
	<!-- While reconnecting, the banner at the top already says what went wrong (statusLabel). -->
	<Toasts {feedback} error={session.error && session.error !== dismissedError && session.connection !== 'reconnecting' ? session.error : undefined} ondismisserror={() => (dismissedError = session.error)} />
</AppShell>
{/if}
