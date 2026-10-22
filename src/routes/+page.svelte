<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { onMount, tick, untrack } from 'svelte';
	import { pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { passkeySupportError } from '$lib/protocol/webauthn';
	import { ChatClient, UNSUPPORTED, defaultWebSocketUrl, findMessage, normalizeWebSocketUrl, serverSettings, timelineMessages, webPushKey, type EmbedEdits, type RoomSnapshot, type WebSocketFactory } from '$lib/protocol/client';
	import { serverOrigin } from '$lib/protocol/embeds';
	import { compareLogIds } from '$lib/protocol/reducer';
	import { destinationUrl, readDestination, type Destination } from '$lib/ui/address';
	import type { Embed, MessageRecord } from '$lib/protocol/types';
	import { isJsonObject } from '$lib/protocol/types';
	import Composer from '$lib/components/Composer.svelte';
	import ReadOnlyBar from '$lib/components/ReadOnlyBar.svelte';
	import ConnectScreen from '$lib/components/ConnectScreen.svelte';
	import { SettleFlag } from '$lib/ui/settle-flag';
	import type { Scheme } from '$lib/ui/sign-in';
	import JumpBar from '$lib/components/JumpBar.svelte';
	import Message, { type MessageCaps } from '$lib/components/Message.svelte';
	import RoomHeader from '$lib/components/RoomHeader.svelte';
	import SelectionBar from '$lib/components/SelectionBar.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import SidebarHandle from '$lib/components/SidebarHandle.svelte';
	import MemberListSidebar from '$lib/components/MemberListSidebar.svelte';
	import NotifyPrompt from '$lib/components/NotifyPrompt.svelte';
	import PanelToggle from '$lib/components/PanelToggle.svelte';
	import ProfileCard from '$lib/components/ProfileCard.svelte';
	import ReactorsPopover from '$lib/components/ReactorsPopover.svelte';
	import StatusBanner from '$lib/components/StatusBanner.svelte';
	import ThreadCard from '$lib/components/ThreadCard.svelte';
	import ThreadSummary from '$lib/components/ThreadSummary.svelte';
	import RoomEditor from '$lib/components/RoomEditor.svelte';
	import NewThreadDialog from '$lib/components/NewThreadDialog.svelte';
	import TypingDots from '$lib/components/TypingDots.svelte';
	import NoticeLine from '$lib/components/NoticeLine.svelte';
	import MembershipLine from '$lib/components/MembershipLine.svelte';
	import { composerAction } from '$lib/ui/commands';
	import { addError, backendHost, statusLabel } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import { FeedbackState } from '$lib/ui/feedback.svelte';
	import { prepareUpload } from '$lib/ui/images';
	import { MentionTracker } from '$lib/ui/mentions.svelte';
	import { IncomingMessageTracker, notificationsByRoom } from '$lib/ui/incoming-messages';
	import { UnreadTracker, countElsewhere } from '$lib/ui/unread.svelte';
	import { ReadPositions } from '$lib/ui/read-positions';
	import { isOwn, mayMove, mentionsMe, peopleIn, replySnippet, senderName, typingLine } from '$lib/ui/messages';
	import { reactionChips, type ReactionChip } from '$lib/ui/reactions';
	import { MessageSelection, type MoveAuthors } from '$lib/ui/selection.svelte';
	import { SessionView } from '$lib/ui/session.svelte';
	import { SidebarLayout } from '$lib/ui/sidebar.svelte';
	import { loadDisplayName, loadMemberListPrefs, loadNotificationsEnabled, notificationsChosen, loadRecentServers, loadServerUrl, loadSidebarPrefs, rememberServer, saveDisplayName, saveMemberListPrefs, saveServerUrl, saveNotificationsEnabled, saveSidebarPrefs, loadNotifyScopes, saveNotifyScopes, NOTIFY_SCOPES_KEY, loadHiddenSummaries, hideSummary, showSummary, summaryHidden, type RecentServer } from '$lib/ui/storage';
	import TimelineLoading from '$lib/design/components/TimelineLoading.svelte';
	import { clearView, loadView, saveView } from '$lib/ui/session-cache';
	import { buildRoomTimeline, buildThreadTimeline, threadEntries, threadLostPrivacy, threadStartedFrom, threadSummaryFor, threadTitleFor } from '$lib/ui/timeline';
	import { askedLinkFailure, linkUse, runSignInLink, sessionSettled, takeSignInLink, type LinkUse, type SignInLink } from '$lib/ui/sign-in-link';
	import { findProposal } from '$lib/protocol/proposals';
	import SignInLinkDialog from '$lib/components/SignInLinkDialog.svelte';
	import { idDateTime, idIso, idTime } from '$lib/ui/time';
	import { tabTitle } from '$lib/ui/attention';
	import { FloatingDay } from '$lib/ui/floating-day.svelte';
	import { trackKeyboard } from '$lib/ui/viewport';
	import { linkPreviews } from '$lib/ui/link-previews';
	import { carriesFiles, fileDrop, pastedFiles } from '$lib/ui/file-transfer';
	import { PaneDrafts, pageDrafts, type StagedFile } from '$lib/ui/pane-drafts.svelte';
	import { PagePresence } from '$lib/ui/presence.svelte';
	import { ProgressiveReveal } from '$lib/ui/reveal.svelte';
	import { setAppBadge, closeReadNotifications, messageNotificationTag, notificationBody, notificationClickTarget, notificationGroup, notificationPermission, pushClickTarget, PUSH_ID_PARAM, PUSH_ID_QUERY, PUSH_ROOM_PARAM, pushRoute, offersAtSignIn, offersNotifications, requestNotificationPermission, showNotification, type PushTarget, type NotificationPermissionState, type NotificationTarget, type NotificationTestResult } from '$lib/ui/notifications';
	import { playPing } from '$lib/ui/attention';
	import { isPaused, muteFor, type PausedUntil } from '$lib/ui/pause';
	import { pageSilenced } from '$lib/ui/user-status';
	import { PushSettings } from '$lib/ui/push-settings.svelte';
	import { inMutedRoom, inNotifyScopes, notifyAccount, notifyScopesOf, pushWake } from '$lib/ui/notify-scopes';
	import { accountServer, canOfferInstall, isStandalone, keepsPushOff, needsHomeScreen, offeredWake, webPushAccount, webPushSupported, type InstallPromptEvent } from '$lib/ui/web-push';

	/**
	 * A thread this viewer created, opened once its `room_update` has arrived;
	 * `replyTo`, the message it was started from, which its composer then
	 * replies to (the thread-from-message convention: see `startThread`).
	 */
	type PendingOpen = {
		room: string;
		thread: string;
		replyTo?: string;
		/** Messages were moved into it already: it opens whatever privacy its record shows, as that was checked before they moved. */
		moved?: true;
	};

	/**
	 * A thread being started, named in the NewThreadDialog: under `room`, with
	 * what its form starts with. From the room's +, nothing else; from a
	 * message, `message`, which its first reply then answers; from select
	 * mode, `moving`, the selected messages that move into it.
	 */
	type NewThread = {
		room: { id: string; title: string; private?: true };
		title: string;
		summary: string;
		message?: string;
		moving?: number;
	};

	/** How near the top of a thread reading back starts loading its older replies. */
	const OLDER_REPLIES_MARGIN_PX = 240;

	/** How long a jump waits for its target to render (a thread's history may still be loading). */
	const JUMP_WAIT_MS = 4000;
	/** Room left above the New divider when a pane opens at it, clear of the floating day. */
	const LAND_MARGIN_PX = 48;
	/** Items rendered above the New divider when a pane opens at it, so there is something to scroll up to. */
	const LAND_CONTEXT_ITEMS = 10;
	/**
	 * Opening a room renders its newest items first, enough to fill the pane,
	 * and the older ones a chunk per frame after that paints, so switching
	 * rooms shows the room without waiting for its whole history to render.
	 */
	const FIRST_PAINT_ITEMS = 40;
	const REVEAL_CHUNK_ITEMS = 60;
	/** How long a members listing stays current when the mention picker opens. */
	const MEMBERS_FRESH_MS = 15_000;
	/** How long the open room's messages wait for its thread listing, so the cards arrive with them. */
	const THREADS_WAIT_MS = 3000;
	/** The shortest gap between keeping the view on this device; leaving the page keeps it at once. */
	const VIEW_SAVE_MS = 2000;
	/** The shortest gap between listings made because the pane has no members. */
	const MEMBERS_RETRY_MS = 10_000;
	/** A new thread of a private room that the server made visible to others (§4.2.4). */
	const PRIVACY_LOST = 'The server made the new thread visible to people outside this private room, so nothing was posted or moved into it. Leave it, or use it knowing that.';

	const session = new SessionView();
	const feedback = new FeedbackState();
	/** The connection error closed from its toast; one that clears and comes back shows again. */
	let dismissedError = $state<string | undefined>();
	const mentions = new MentionTracker();
	/** How many mentions of you have arrived outside the rooms you muted: each new one can alert the tab. */
	let audibleMentions = $state(0);
	const incomingMessages = new IncomingMessageTracker();
	const unread = new UnreadTracker();
	/** How far you have read each room and thread, kept for the account (or this server's guests) on this device. */
	const readPositions = new ReadPositions(() => notifyKey);
	const presence = new PagePresence();
	const floatingDay = new FloatingDay();
	const drafts = new PaneDrafts();
	// The update notice, in the layout, says when reloading would lose a draft.
	$effect(() => {
		pageDrafts.current = drafts;
		return () => {
			if (pageDrafts.current === drafts) pageDrafts.current = undefined;
		};
	});
	const reveal = new ProgressiveReveal(REVEAL_CHUNK_ITEMS, () => messageScroll, keepPlace);
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
	 * Notifications on this device, one setting: the page's own while Apron is open, and push
	 * for this account while it's closed. On if either is, so a choice made with the two
	 * switches before carries over; and only while still allowed, since the browser's
	 * permission can be revoked or reset behind the setting.
	 */
	let notificationsActive = $derived((notificationsEnabled || webPushActive) && notificationState === 'granted');
	/**
	 * Push is on for this account, but the subscription is another account's, on
	 * a server with another key, that still has push on: that server's host. It
	 * moves here only when push is turned on here again, so two tabs don't take
	 * it back and forth.
	 */
	let webPushHeldBy = $derived.by(() => {
		const server = webPushActive ? pushSettings.heldBy(pushAccount, webPushServerKey) : undefined;
		return server === undefined ? undefined : backendHost(server) || 'another server';
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
	/** Chromium's offer to install Apron, kept for the push setting's Install app button. */
	let installPrompt = $state<InstallPromptEvent | undefined>();
	/** The account's `push_id` (§4.9): it names the account in pushed payloads and in message notifications. */
	let accountPushId = $derived(pushSettings.accountPushId);
	/** A pushed room to open once it is listed, if its `push_id` is this account's. */
	let pushRoom = $state<Pick<PushTarget, 'roomId' | 'pushId'> | undefined>();
	/** A room, thread or message the page's URL named when it opened, to open once its server lists its rooms. */
	let linked = $state<(Destination & { server: string; room: string }) | undefined>();
	/** The connect screen is up for a link's server: it can be cancelled even before this server is ready. */
	let offeringLink = $state(false);
	/** How far back a linked message is looked for, in pages of history. */
	const LINKED_MESSAGE_PAGES = 20;
	/** How long a pushed room waits for its account and rooms before it is dropped. */
	const PUSH_ROOM_WAIT_MS = 30_000;
	/** Tells this tab's notifications apart from other tabs' when the service worker relays a click. */
	const tabId = Math.random().toString(36).slice(2);
	const selection = new MessageSelection();
	const sidebar = new SidebarLayout({ side: 'left', defaultWidth: 248, minWidth: 160, maxWidth: 480, load: loadSidebarPrefs, save: saveSidebarPrefs });
	/** The member list's width and, on wide screens, whether it's collapsed. */
	const memberList = new SidebarLayout({ side: 'right', defaultWidth: 240, minWidth: 180, maxWidth: 420, load: loadMemberListPrefs, save: saveMemberListPrefs });

	/** `/__preview` passes its in-memory server's sockets; every other visit connects for real. */
	let { webSocketFactory }: { webSocketFactory?: WebSocketFactory } = $props();
	/** Against the in-memory server: no backend to pick, and nothing remembered. */
	const previewMode = untrack(() => webSocketFactory !== undefined);

	let client = $state<ChatClient | undefined>();
	let serverInput = $state('');
	let displayName = $state('');
	/** The `user_id`s the composer's chips mention (§3.5), sent as `body.mentions`. */
	let composerMentions = $state<string[]>([]);
	/** Link previews removed from the composer's draft, by URL. */
	let composerDismissed = $state<string[]>([]);
	let connectOpen = $state(false);
	/** The sign-in scheme the connect screen opens with, when something asked for one. */
	let connectScheme = $state<Scheme | undefined>();
	let recentServers = $state<RecentServer[]>([]);
	let passkeyUnavailable = $state<string | undefined>();
	let highlightedId = $state<string | undefined>();
	let editingId = $state<string | undefined>();
	/** The Edit form for the open room or thread (its title and description). */
	let roomEditorOpen = $state(false);
	/** A sign-in link of no proposal this browser made (§4.11.2), until the viewer answers whether to use it. */
	let askedLink = $state<SignInLink | undefined>();
	/** A link is being used: its token goes out as a fresh connection's first `auth`, or adds to this account. */
	let linkBusy = $state(false);
	/** A link for an addition this browser proposed (§4.11.3), waiting for the session of the account that proposed it. */
	let linkAddition = $state<Extract<LinkUse, { kind: 'addition' }> | undefined>();
	/** Why a sign-in link didn't sign in, for the connect screen. */
	let linkFailure = $state<{ error: string } | undefined>();
	/** The open thread's `room_id`; undefined in the room view. */
	let activeThread = $state<string | undefined>();
	let selectedRoomId = $state<string | undefined>();
	let pendingOpen = $state<PendingOpen | undefined>();
	/** A room or thread joined from the directory or just created, opened once its `room_update` has arrived. */
	let pendingJoin = $state<string | undefined>();
	/** `pendingJoin` was created as a private room: its record must say `private: true` before it is used (§4.2.4). */
	let pendingPrivate = $state(false);
	/**
	 * Where the New divider sits in the open pane: after your read position
	 * (`ReadPositions`) as it was when the pane opened. It stays put while you
	 * read. `landed` once the pane has opened at it (or stayed at the latest).
	 */
	let newDivider = $state<{ room: string; after?: string; fixed: boolean; landed: boolean }>({ room: '', fixed: false, landed: false });
	/** The visit to a pane (its `newDivider`) that `landAtDivider` is opening at its divider. */
	let landing: object | undefined;
	/** The NewThreadDialog, asking for a new thread's title and summary, until it closes. */
	let newThread = $state<NewThread | undefined>();
	/** Threads this page started, by the message they were started from: Start thread again opens the same one. */
	const startedThreads = new Map<string, string>();
	let mobilePane = $state<'rooms' | 'main'>('main');
	/** Wide screens give the member list a column of its own; narrower ones overlay it on the conversation. */
	let memberListWide = $state(false);
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
	let composer = $state<Composer | undefined>();
	let memberListToggle = $state<PanelToggle | undefined>();
	let messageScroll = $state<HTMLDivElement | undefined>();
	let stickToBottom = $state(true);
	let latestVisible = $state(true);
	/** The pane `latestVisible` was last measured in: until it is this one, it says nothing about this one. */
	let latestVisibleIn = $state<string | undefined>();
	/** The newest message you had on screen in the pane, for counting what arrived since. */
	let seenThrough = $state<string | undefined>();
	/** Bumped when you send or jump to the latest: a pane still opening at its divider stays at the latest instead. */
	let pins = 0;
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	/** The last read whose notifications were closed (account, server, room, message), so each closes once. */
	let closedThrough: string | undefined;
	/** Numbers staged files, so each can be taken off its draft. */
	let stagedCount = 0;
	/** Where the last scroll event, or automatic scroll to the latest item, left the list. */
	let lastScrollTop: number | undefined;
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;

	let snapshot = $derived(session.snapshot);
	$effect(() => {
		if (!snapshot.error) untrack(() => (dismissedError = undefined));
	});
	/** The top-level room open in the pane (or behind the open thread). */
	let activeRoom = $derived(session.activeRoom);
	/** The active room's threads: the joined ones, then those listed as not joined, which get cards too. */
	let threadSource = $derived(session.threadSource(activeRoom?.id));
	let threads = $derived(threadEntries(threadSource.rooms, activeRoom?.id, threadSource.directory));
	let joinedThreads = $derived(threads.filter((entry) => entry.joined));
	/** The sidebar lists joined threads, and a thread open without joining while it is open. */
	let listedThreads = $derived(threads.filter((entry) => entry.joined || entry.id === activeThread));
	/** The open thread, joined or read without joining; the client holds either as a room. */
	let activeThreadEntry = $derived(activeThread && session.rooms.some((room) => room.id === activeThread) ? threads.find((entry) => entry.id === activeThread) : undefined);
	let threadRoom = $derived(activeThreadEntry ? session.rooms.find((room) => room.id === activeThreadEntry.id) : undefined);
	/** The room the pane shows and the composer posts to: the open thread (itself a room), else the room. */
	/**
	 * The rooms whose thread listing (`room_list` with their `parent_room_id`) has settled on this connection.
	 * Until the open room's has, its messages wait with it (a held copy, or placeholders), so the thread cards
	 * don't arrive on their own afterwards and shift the timeline. Once per room: switching back doesn't wait.
	 */
	let threadsListed = $state<readonly string[]>([]);
	let awaitingThreads = $derived(Boolean(session.ready && session.canManageRooms && session.activeRoomId && !threadsListed.includes(session.activeRoomId)));
	$effect(() => {
		if (!session.ready) threadsListed = [];
	});
	$effect(() => {
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

	/** When the view was last kept on this device: a busy room saves at most once per `VIEW_SAVE_MS`. */
	let viewSavedAt = 0;
	function keepView(): void {
		const view = untrack(() => session.keepable);
		const you = untrack(() => session.snapshot.you);
		// Only for a session saved here (a passkey or email account): a guest's next visit is someone new.
		if (previewMode || !client || !view || !you || !client.keptSessionFor(client.url)) return;
		viewSavedAt = Date.now();
		void saveView(client.url, you.user_id, view);
	}
	$effect(() => {
		if (!session.keepable) return;
		const timer = setTimeout(keepView, Math.max(0, viewSavedAt + VIEW_SAVE_MS - Date.now()));
		return () => clearTimeout(timer);
	});
	let paneRoom = $derived(activeThread ? threadRoom : activeRoom);
	/** What's new in the rooms and threads other than the one being read, as the rooms list counts it: the phone header's back button shows it. */
	let unreadElsewhere = $derived(countElsewhere(unread.byRoom, paneRoom?.id));
	let mentionsElsewhere = $derived(countElsewhere(mentions.byRoom, paneRoom?.id));
	/**
	 * The open pane is catching up: its history is recovering or loading, or it shows a copy held from before
	 * (a reconnect, or a reload) until the live one replaces it. The timeline says so at its foot.
	 */
	let paneCatchingUp = $derived(Boolean(paneRoom && (paneRoom.recovering || paneRoom.loading || session.showingHeld || (!activeThread && (session.activeRoomHeld || awaitingThreads)))));
	/** `paneCatchingUp` or a quiet reconnect, as the floating pill shows it: only once it outlasts a moment, then for a moment at least. */
	let checkingShown = $state(false);
	const checking = new SettleFlag((on) => (checkingShown = on));
	/** A short drop of the connection, kept quiet: everything stays on screen while the socket comes back. */
	let quietReconnect = $derived(session.connection === 'reconnecting' && !session.reconnectNeedsAttention);
	// One pill for the whole way back: "Reconnecting…", then checking for what came meanwhile.
	$effect(() => checking.set(paneCatchingUp || quietReconnect));
	$effect(() => () => checking.dispose());
	/** Nothing held to show while the room's threads are listed: placeholders, so its messages and thread cards appear together. */
	let paneHeldBack = $derived(awaitingThreads && !activeThread && !session.activeRoomHeld);
	let messages = $derived(timelineMessages(paneRoom));
	let timeline = $derived(activeThread
		? buildThreadTimeline({ messages, renames: paneRoom?.renames, notices: paneRoom?.notices })
		: buildRoomTimeline({ messages, threads, notices: paneRoom?.notices, memberships: paneRoom?.timeline.memberships }));
	let shownTimeline = $derived(reveal.hidden > 0 ? timeline.slice(Math.min(reveal.hidden, timeline.length)) : timeline);
	/** The pane is live: its room is listed, and no sign-in is under way. */
	let paneReady = $derived(Boolean(paneRoom && session.ready && !snapshot.authBusy));
	/** Writing here: posting, replying, reacting, and editing threads. A guest who only reads can't. */
	let canCompose = $derived(paneReady && !session.readOnly);
	/** Files dropped on the conversation or pasted outside the field attach to the draft while the composer is showing. */
	let canAttach = $derived(canCompose && snapshot.capabilities['embed:upload'] && !selection.active);
	/** Files are being dragged over the conversation. */
	let dropping = $state(false);
	let people = $derived(peopleIn([...(activeThread ? timelineMessages(activeRoom) : []), ...messages], session.you, paneRoom?.members));
	let roomSuggestions = $derived.by(() => {
		const rooms = new Map<string, { id: string; title: string }>();
		for (const room of [...(snapshot.directory ?? []), ...Object.values(snapshot.threadDirectory).flat(), ...session.rooms]) {
			rooms.set(room.id, { id: room.id, title: room.title });
		}
		return [...rooms.values()];
	});
	let typingNames = $derived(snapshot.typing
		.filter((entry) => entry.room === paneRoom?.id && entry.from.user_id !== session.you?.user_id)
		.map((entry) => directory.name(entry.from)));
	/** The first message after your read position, unless you wrote it: the New divider goes above it. */
	let newDividerBefore = $derived.by(() => {
		if (newDivider.room !== paneRoom?.id || newDivider.after === undefined) return undefined;
		const after = newDivider.after;
		// The first message row after the cursor.
		for (const item of timeline) {
			if (item.kind !== 'message' || compareLogIds(item.event.message_id, after) <= 0) continue;
			return isOwn(item.event, session.you) ? undefined : item.event.message_id;
		}
		return undefined;
	});
	// `server.agent` names the implementation, for debugging, not the server: the host is the label.
	let backendLabel = $derived(backendHost(serverInput) || 'Apron');
	let threadReplyCount = $derived(threadRoom?.loaded ? messages.length : undefined);
	/** Messages after the newest you had on screen, by `message_id`, so older ones loading above don't count. */
	let unseenCount = $derived.by(() => {
		const seen = seenThrough;
		if (stickToBottom || seen === undefined) return 0;
		let count = 0;
		for (let index = messages.length - 1; index >= 0 && compareLogIds(messages[index].message_id, seen) > 0; index--) count++;
		return count;
	});
	/**
	 * You are reading the open pane's latest message: it is on screen, as
	 * measured in this pane, and the pane has opened at its divider.
	 */
	let readingLatest = $derived(latestVisible && latestVisibleIn === paneRoom?.id && newDivider.room === paneRoom?.id && newDivider.landed);
	/** The pane's messages this viewer may pick, in order: what shift-click ranges run along. */
	let selectableOrder = $derived(messages.filter(canSelect).map((event) => event.message_id));
	let selectThreads = $derived(joinedThreads.filter((entry) => entry.id !== activeThread));
	/** New threads hang off a top-level room; this client keeps threads one level deep. */
	let canStartThreads = $derived(session.canManageRooms && !session.readOnly && Boolean(activeRoom) && activeRoom?.parentRoomId === undefined);
	/** Editing the open room's or thread's title and description (capability `rooms`); the server decides who may. */
	let canEditPane = $derived(session.canManageRooms && !session.readOnly && Boolean(activeThread ? activeThreadEntry : activeRoom));
	/** What the Edit form edits: the open thread, else the room. */
	let editTarget = $derived(activeThread
		? (activeThreadEntry ? { id: activeThreadEntry.id, title: activeThreadEntry.title, description: activeThreadEntry.description } : undefined)
		: (activeRoom ? { id: activeRoom.id, title: activeRoom.title, description: activeRoom.description } : undefined));
	/** Room and thread summaries put away with their ×, on this device. */
	let hiddenSummaries = $state(loadHiddenSummaries());
	/** Whether the open room's or thread's description is put away: the header's Summary brings it back. */
	let summaryPutAway = $derived(Boolean(editTarget?.description && summaryHidden(hiddenSummaries, draftKey(editTarget.id), editTarget.description)));
	/** The open room's or thread's description, pinned under the header until its × puts it away (and again once it's edited). */
	let pinnedSummary = $derived(editTarget?.description && !summaryPutAway ? { id: editTarget.id, description: editTarget.description } : undefined);
	/** Adding and removing other members of the open pane's room (§4.2.2), until the server says it can't. */
	let canChangeMembers = $derived(session.canManageRooms && !session.readOnly && paneReady);

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

	$effect(() => {
		// A held view (a reconnect, or one kept on this device) is from before: nothing in it has just arrived.
		if (session.showingHeld) return;
		const arrivedMentions = mentions.observe(session.rooms, session.you, paneRoom?.id, latestVisible);
		const arrivedMessages = incomingMessages.observe(session.rooms, session.you);
		// A mention in a room you muted (§4.5) doesn't alert the tab either.
		const audible = arrivedMentions.filter((event) => !inMutedRoom(event, session.rooms)).length;
		if (audible) untrack(() => (audibleMentions += audible));
		// The first mention you'd hear offers notifications, until they're chosen on this device.
		const offered = audible > 0 && untrack(() => !notifyOffer && offersNotifications({ chosen: notificationsChoiceMade, active: notificationsActive, permission: notificationState, silenced }));
		if (offered) {
			const first = arrivedMentions.find((event) => !inMutedRoom(event, session.rooms));
			const room = first && session.rooms.find((candidate) => candidate.id === first.room_id);
			if (first) untrack(() => (notifyOffer = { from: senderName(first), room: room?.title ?? first.room_id }));
		}
		if (!notificationsActive || !presence.away || silenced) return;
		const mentioned = new Set(arrivedMentions.map((event) => event.message_id));
		// The checked scopes, judged here; an edit that adds you counts as a mention.
		const context = { me: session.you, rooms: session.rooms };
		const selected = [...arrivedMessages, ...arrivedMentions]
			.filter((event) => inNotifyScopes(event, notifyScopes, { ...context, mentioned: mentioned.has(event.message_id) }));
		for (const event of notificationsByRoom(selected, mentioned)) untrack(() => void notifyMessage(event, mentioned.has(event.message_id)));
	});

	// Your read cursors as the server reports them, and your own newest messages, move your read positions.
	$effect(() => {
		if (session.showingHeld) return;
		readPositions.observe(session.rooms, session.you);
	});

	$effect(() => {
		if (session.showingHeld) return;
		const me = session.you;
		unread.observe(session.rooms, me, paneRoom?.id, readingLatest && presence.visible, (room) => readPositions.through(room, me));
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

	// While Apron is in view, the app badge shows its own unread count; away, pushes' `unread` sets it.
	$effect(() => {
		const total = unread.total;
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
		untrack(() => openDestination(room.parentRoomId ?? room.id, room.parentRoomId ? room.id : undefined));
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
		void [session.rooms, session.snapshot.directory, session.snapshot.threadDirectory[pending.room], activeRoom?.id, activeThread];
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

	// The New divider is placed once per visit, from your read position: kept on this device, the server's cursor, or your newest message.
	$effect(() => {
		const room = paneRoom;
		if (!room) return;
		if (newDivider.room !== room.id) newDivider = { room: room.id, fixed: false, landed: false };
		else if (!newDivider.fixed && room.loaded) newDivider = { room: room.id, after: untrack(() => readPositions.through(room, session.you, true)), fixed: true, landed: false };
	});

	// Then the pane opens at it, where you left off, unless something already moved it from the latest.
	$effect(() => {
		const room = paneRoom;
		if (!room || newDivider.room !== room.id || !newDivider.fixed || newDivider.landed) return;
		untrack(() => void landAtDivider(room.id));
	});

	// Reading the latest message advances your read position, and your read cursor (capability `activity`),
	// which the server syncs to your other devices.
	$effect(() => {
		const room = paneRoom;
		const last = messages[messages.length - 1];
		// Only once this pane has opened at its divider: advancing first would hide what was new.
		if (!client || !room || !last || !readingLatest || !presence.visible || !room.loaded || !session.ready) return;
		const looking = !presence.away;
		untrack(() => {
			readPositions.read(room.id, last.message_id);
			client?.markRead(room.id, last.message_id);
			// What you just read here no longer needs its notifications on this device. Only once
			// you're looking (focused too): an unfocused window shows its own desktop notification
			// of what arrives, which must stay until you come back.
			if (!looking) return;
			const read = `${accountPushId ?? ''}:${client?.url}:${room.id}:${last.message_id}`;
			if (read === closedThrough || !client) return;
			closedThrough = read;
			void closeReadNotifications(accountPushId ? { group: notificationGroup(accountPushId, room.id) } : { tag: `apron:${client.url}:${room.id}` }, last.message_id);
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
		const room = joined ? session.rooms.find((candidate) => candidate.id === joined) : undefined;
		if (!room) return;
		pendingJoin = undefined;
		// A server that doesn't keep private rooms may create an ordinary one anyway: say so, and don't open it to post in.
		if (untrack(() => pendingPrivate) && !room.private) {
			pendingPrivate = false;
			untrack(() => feedback.error(`The server made “${room.title}” an ordinary room that others can see and join, not a private one. Leave it, or use it knowing that.`));
			return;
		}
		pendingPrivate = false;
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
		if (previewMode || promptedSignIn || connectOpen || askedLink || linkBusy || linkAddition || snapshot.authBusy || !server || snapshot.authenticated || snapshot.status !== 'connected') return;
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
		if (!session.canEdit) selection.cancel();
	});

	// A thread this viewer just created opens once its `room_update` has arrived.
	$effect(() => {
		const pending = pendingOpen;
		if (!pending || !session.rooms.some((room) => room.id === pending.thread)) return;
		pendingOpen = undefined;
		// A thread of a private room is private too (§4.2.4); one the server made visible isn't opened to reply in.
		if (!pending.moved && threadLostPrivacy(session.rooms, pending.room, pending.thread)) {
			untrack(() => feedback.error(PRIVACY_LOST));
			return;
		}
		untrack(() => {
			openDestination(pending.room, pending.thread);
			if (pending.replyTo !== undefined && !drafts.reply) drafts.setReply(pending.replyTo);
		});
	});

	// A thread's first page may not fill the pane, leaving nothing to scroll back
	// with: load older replies until it does or there are none.
	$effect(() => {
		const room = threadRoom;
		void timeline.length;
		if (!room?.loaded || !room.olderAvailable || room.loadingOlder || !messageScroll) return;
		untrack(() => {
			tick().then(() => {
				if (messageScroll && messageScroll.scrollHeight <= messageScroll.clientHeight + OLDER_REPLIES_MARGIN_PX) void loadOlderReplies();
			});
		});
	});

	// Threads don't recover with their parent: the open one loads its own history,
	// again after a reconnect, which lists it afresh.
	$effect(() => {
		const room = threadRoom;
		// A held copy (from before a reconnect or a reload) isn't the live thread: that one loads once it's listed.
		if (!client || !room || !session.ready || session.showingHeld || room.loaded || room.loading || room.recoveryError) return;
		untrack(() => loadThread(room.id));
	});

	$effect(() => {
		if (editingId && !timeline.some((item) => item.kind === 'message' && item.event.message_id === editingId && !item.event.deleted)) {
			editingId = undefined;
		}
	});

	$effect(() => {
		messages.length;
		paneRoom?.id;
		if (!stickToBottom || !messageScroll) return;
		requestAnimationFrame(() => {
			if (stickToBottom) scrollToLatest();
		});
	});

	// The timeline is anchored at its bottom edge, as chat apps are: when something in the pane takes more or less
	// room below it (the composer growing a line, a reply bar, staged files, the typing row), what sat just above the
	// composer stays there, pushed up rather than covered: at the latest message it stays there, and scrolled back,
	// the view moves with the edge. Before the frame paints. The window resizing (the pane's own height) is left be,
	// but not an on-screen keyboard coming up or going down (trackKeyboard), which takes room as the composer does.
	$effect(() => {
		const scroll = messageScroll;
		const pane = scroll?.closest<HTMLElement>('.ap-shell-main');
		if (!scroll || !pane) return;
		const root = document.documentElement;
		let height = scroll.clientHeight;
		let paneHeight = pane.clientHeight;
		let keyboardHeight = root.style.getPropertyValue('--app-height');
		const observer = new ResizeObserver(() => {
			const next = scroll.clientHeight;
			const change = height - next;
			const paneChanged = pane.clientHeight !== paneHeight;
			const keyboardChanged = root.style.getPropertyValue('--app-height') !== keyboardHeight;
			height = next;
			paneHeight = pane.clientHeight;
			keyboardHeight = root.style.getPropertyValue('--app-height');
			if (!change || (paneChanged && !keyboardChanged)) return;
			if (stickToBottom) scrollToLatest();
			else scroll.scrollTop += change;
			// A message being edited stays in view over the keyboard.
			const active = document.activeElement;
			if (keyboardChanged && active instanceof HTMLElement && scroll.contains(active)) active.scrollIntoView({ block: 'nearest' });
		});
		observer.observe(scroll);
		observer.observe(pane);
		return () => observer.disconnect();
	});

	// Stay pinned to the latest item while the pane fills in: a room's history, its threads'
	// cards and summaries land over several updates, not all of which change what the effect
	// above tracks. Follow the rendered content instead.
	$effect(() => {
		const scroll = messageScroll;
		if (!scroll) return;
		let frame = 0;
		const observer = new MutationObserver(() => {
			if (!stickToBottom || frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				if (stickToBottom) scrollToLatest();
			});
		});
		observer.observe(scroll, { childList: true, subtree: true, characterData: true });
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});

	$effect(() => {
		const scroll = messageScroll;
		const items = timeline;
		const pane = paneRoom?.id;
		if (!scroll) return;
		let observer: IntersectionObserver | undefined;
		const frame = requestAnimationFrame(() => {
			const nodes = scroll.querySelectorAll<HTMLElement>('[data-timeline-item]');
			const latest = nodes[nodes.length - 1];
			if (!items.length || !latest) {
				latestVisible = true;
				latestVisibleIn = pane;
				return;
			}
			observer = new IntersectionObserver(([entry]) => {
				latestVisible = entry.isIntersecting;
				latestVisibleIn = pane;
				if (latestVisible) {
					seenThrough = messages[messages.length - 1]?.message_id;
					mentions.clearUnseen();
				}
			}, { root: scroll });
			observer.observe(latest);
		});
		return () => {
			cancelAnimationFrame(frame);
			observer?.disconnect();
		};
	});

	onMount(() => trackKeyboard());

	onMount(() => {
		passkeyUnavailable = passkeySupportError();
		sidebar.load();
		memberList.load();
		requestAnimationFrame(() => requestAnimationFrame(() => (slidesReady = true)));
		const memberListMedia = window.matchMedia('(min-width: 960px)');
		const memberListMediaChange = ({ matches }: { matches: boolean }) => {
			memberListWide = matches;
			memberListOverlay = false;
		};
		memberListMediaChange(memberListMedia);
		memberListMedia.addEventListener('change', memberListMediaChange);
		// Taken, and scrubbed from the address bar, before anything else can read or keep the URL.
		const signInLink = previewMode ? undefined : takeSignInLink(window.location, scrubUrl);
		// A link pasted into this tab later is a same-document fragment change: take (and scrub) it too.
		const hashChanged = () => {
			const link = previewMode ? undefined : takeSignInLink(window.location, scrubUrl);
			if (link) {
				followLink(link);
				return;
			}
			// A message link differing only in its fragment doesn't reload the page: go to it here.
			const destination = readDestination(window.location);
			if (client && destination.room && destination.message) {
				linked = { ...destination, server: previewMode ? client.url : destination.server ?? homeServer(), room: destination.room };
			}
		};
		window.addEventListener('hashchange', hashChanged);
		serverInput = previewMode ? 'ws://apron-preview.invalid' : loadServerUrl() ?? defaultWebSocketUrl(window.location);
		displayName = previewMode ? 'Preview User' : loadDisplayName();
		recentServers = previewMode ? [] : loadRecentServers();
		notificationsEnabled = loadNotificationsEnabled();
		notificationsChoiceMade = notificationsChosen();
		notificationState = notificationPermission();
		if (!previewMode) pushSettings.load();
		webPushAvailable = webPushSupported();
		runsInstalled = isStandalone();
		// Push turned on or off in another tab applies here too.
		const storageChanged = (event: StorageEvent) => {
			if (previewMode) return;
			pushSettings.storageChanged(event.key);
			if (event.key === NOTIFY_SCOPES_KEY) notifyScopesSaved += 1;
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
		const installed = () => (installPrompt = undefined);
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
		const linkServer = previewMode ? undefined : link.server ?? (link.room ? homeServer() : undefined);
		let offeredServer: string | undefined;
		if (linkServer && linkServer !== normalizeWebSocketUrl(serverInput, window.location)) {
			if (linkServer === homeServer() || recentServers.some((recent) => recent.url === linkServer)) {
				serverInput = linkServer;
				saveServerUrl(linkServer);
			} else {
				offeredServer = linkServer;
			}
		}
		const chat = new ChatClient(
			normalizeWebSocketUrl(serverInput, window.location),
			displayName,
			webSocketFactory
		);
		// The view from this device's last visit, while this one signs in and catches up: only for the session
		// saved here, which is the account it was kept for (a sign-in as anyone else drops it).
		if (!previewMode && chat.keptSessionFor(chat.url)) {
			void loadView(chat.url).then((kept) => {
				if (kept && client === chat) session.prime(kept.view);
			});
		}
		const unsubscribe = chat.subscribe((next) => {
			serverUrl = chat.url;
			session.apply(next, chat);
			directory.apply(next, serverOrigin(chat.url));
		});
		chat.start();
		client = chat;
		if (signInLink) followLink(signInLink);
		if (pushed) void followPush(chat, pushed);
		if (link.room) linked = { ...link, server: offeredServer ?? chat.url, room: link.room };
		if (offeredServer) {
			serverInput = offeredServer;
			offeringLink = true;
			openConnect();
		}
		return () => {
			memberListMedia.removeEventListener('change', memberListMediaChange);
			window.removeEventListener('hashchange', hashChanged);
			window.removeEventListener('storage', storageChanged);
			for (const type of ['keydown', 'pointerdown'] as const) window.removeEventListener(type, pressed, inputOptions);
			for (const type of ['pointermove', 'wheel', 'touchmove'] as const) window.removeEventListener(type, moved, inputOptions);
			window.removeEventListener('beforeinstallprompt', installOffered);
			window.removeEventListener('appinstalled', installed);
			if (typingTimer) clearTimeout(typingTimer);
			if (highlightTimer) clearTimeout(highlightTimer);
			reveal.stop();
			floatingDay.dispose();
			presence.dispose();
			worker?.removeEventListener('message', notificationClicked);
			if (permission) permission.onchange = null;
			feedback.dispose();
			mentions.dispose();
			session.dispose();
			unsubscribe();
			chat.stop();
		};
	});

	// --- Connecting ---

	/**
	 * A sign-in link (§4.11.2), emailed or the return from an external
	 * sign-in page. One with the `state` of a sign-in this browser proposed
	 * is used at once, on the server it was proposed to; one for an addition
	 * waits for the session of the account that proposed it; any other is a
	 * credential someone else may have crafted or forwarded, and the viewer
	 * is asked first.
	 */
	function followLink(link: SignInLink): void {
		const use = linkUse(link, (state) => findProposal(state));
		if (!use) return;
		if (use.kind === 'addition') linkAddition = use;
		else if (use.kind === 'own') useLink(use);
		else askedLink = use.link;
	}

	/**
	 * Signs in with a link of this browser's own proposal, or one the viewer
	 * confirmed having been shown its server: the client presents its token
	 * on a fresh connection that is not signed in (§4.11.3), and carries on
	 * with that connection once it has worked, when the page lets go of the
	 * view it held. A link adds to an account only with the `state` of an
	 * addition proposed here (`linkAddition`), or once the viewer says a
	 * link of no proposal here is one (`addAskedLink`). A failure changes
	 * nothing and opens the connect screen on the link's scheme and server,
	 * with the reason.
	 */
	function useLink(use: Exclude<LinkUse, { kind: 'addition' }>): void {
		const chat = client;
		askedLink = undefined;
		if (!chat) return;
		linkBusy = true;
		feedback.pending('Signing in…');
		void runSignInLink(use, chat, {
			// Another account from here on: the view held for the current one goes, and on this
			// server it is signed out of, push going off for it as a sign-out does.
			beforeSwitch: (switched) => (switched ? leaveBackend() : signedOut()()),
			onSignedIn: (server, switched) => {
				feedback.clear();
				linkFailure = undefined;
				// Only now is a switch to the link's server remembered, and the server listed as recent.
				if (switched) {
					serverInput = server;
					saveServerUrl(server);
				}
				connected();
			},
			onFailed: (error, server) => {
				feedback.clear();
				// The link may have expired or been used: the connect screen can start again, on the
				// link's server, which is not remembered unless that works. One of no proposal here
				// may have been for an addition instead, which a new sign-in code wouldn't help with.
				serverInput = server;
				linkFailure = {
					error: use.kind === 'own'
						? `The sign-in link didn’t work (${error}). ${use.scheme === 'email' ? 'Send a new code' : 'Sign in again'} to try again, or pick another server.`
						: askedLinkFailure(error)
				};
				connectScheme = use.kind === 'own' ? use.scheme : undefined;
				connectOpen = true;
			}
		}).finally(() => (linkBusy = false));
	}

	/**
	 * Adds a link of no proposal here to the account this page is signed in
	 * to, once the viewer said it was sent for that (§4.11.3): the server
	 * approves it only if that account proposed it, so any other link is
	 * refused, and changes nothing.
	 */
	function addAskedLink(link: SignInLink): void {
		const chat = client;
		askedLink = undefined;
		if (!chat) return;
		linkBusy = true;
		feedback.pending('Adding the sign-in…');
		chat.addWithConfirmedLink(link.token)
			.then(() => feedback.clear(), (cause: unknown) => feedback.error(addError(cause, 'link')))
			.finally(() => (linkBusy = false));
	}

	// A link for an addition this browser proposed (§4.11.3) approves only on a connection signed in to the
	// account that proposed it: once this page's session has settled (a kept one resumed, or past resuming), it
	// adds there, or says it can't.
	$effect(() => {
		const addition = linkAddition;
		const chat = client;
		if (!addition || !chat || !sessionSettled(snapshot)) return;
		const signedInAs = snapshot.authenticated ? snapshot.you?.user_id : undefined;
		untrack(() => {
			linkAddition = undefined;
			if (chat.url !== addition.server || signedInAs !== addition.account) {
				feedback.error(`The link adds a sign-in to @${addition.account} on ${backendHost(addition.server) || addition.server}, which this page isn’t signed in as now. Sign in as @${addition.account} there, and add it again.`);
				return;
			}
			linkBusy = true;
			feedback.pending('Adding the sign-in…');
			chat.addWithLink(addition.token, addition.state)
				.then(() => feedback.clear(), (cause: unknown) => feedback.error(addError(cause, findProposal(addition.state)?.scheme)))
				.finally(() => (linkBusy = false));
		});
	});

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
		linkFailure = undefined;
		if (options.name) displayName = options.name;
		connectOpen = true;
	}

	/** Asks `room_list` for the pane's members, unless a listing was answered within `maxAge`. */
	function listMembers(maxAge: number): void {
		const room = paneRoom;
		if (!client || !room || !session.ready || !session.canManageRooms) return;
		client.listMembers(room.id, maxAge).catch(() => undefined);
	}

	/** The connect form was submitted: whatever belonged to the previous backend goes. */
	function leaveBackend(): void {
		drafts.open(undefined);
		selectedRoomId = undefined;
		activeThread = undefined;
		pendingOpen = undefined;
		pendingJoin = undefined;
		pendingPrivate = false;
		newThread = undefined;
		roomEditorOpen = false;
		selection.cancel();
		mentions.reset();
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
		const body = notificationBody(event.body?.text);
		const id = accountPushId;
		const target: NotificationTarget = {
			tab: tabId, server: client.url, roomId: room.parentRoomId ?? room.id, ...(room.parentRoomId ? { threadId: room.id } : {}),
			...(id ? { pushId: id, messageId: event.message_id, group: notificationGroup(id, room.id) } : {})
		};
		const shown = await showNotification(`${senderName(event)} · ${room.title}`, {
			body: body || 'New message',
			// One per message, shared with the server's push of it (§4.9), which replaces it quietly;
			// a newer message in the room closes it. Without a `push_id`, one per room.
			...(id ? { tag: messageNotificationTag(id, event.message_id), renotify: false } : { tag: `apron:${client.url}:${room.id}`, renotify: true }),
			data: target
		}, () => openNotificationTarget(target));
		if (!shown && mention) playPing();
	}

	function openNotificationTarget(target: NotificationTarget): void {
		window.focus();
		if (target.tab === tabId && target.server === client?.url) openDestination(target.roomId, target.threadId);
	}

	/**
	 * The service worker relays a click on a notification it showed to the
	 * tabs, and asks each which account it is signed in to.
	 */
	function notificationClicked(event: MessageEvent): void {
		if (isJsonObject(event.data) && event.data.type === PUSH_ID_QUERY) {
			event.ports[0]?.postMessage({ pushId: accountPushId });
			return;
		}
		const target = notificationClickTarget(event.data);
		if (target) openNotificationTarget(target);
		const pushed = pushClickTarget(event.data);
		if (pushed) openPushedRoom(pushed);
	}

	/** A push notification's room opens in a tab signed in to the account its `push_id` names. */
	function openPushedRoom(target: Pick<PushTarget, 'roomId' | 'pushId'>): void {
		window.focus();
		pushRoom = target;
	}

	/**
	 * A tab opened for a push notification goes to the server of the account it
	 * was pushed for, if push is on for that account here and it isn't the
	 * remembered server, as the connect screen would.
	 */
	async function followPush(chat: ChatClient, target: Pick<PushTarget, 'roomId' | 'pushId'>): Promise<void> {
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

	/** Takes, and scrubs from the address bar, the room and `push_id` of a push notification this tab was opened for. */
	function takePushRoom(): Pick<PushTarget, 'roomId' | 'pushId'> | undefined {
		const url = new URL(window.location.href);
		const roomId = url.searchParams.get(PUSH_ROOM_PARAM) ?? undefined;
		const id = url.searchParams.get(PUSH_ID_PARAM) || undefined;
		if (roomId === undefined) return undefined;
		url.searchParams.delete(PUSH_ROOM_PARAM);
		url.searchParams.delete(PUSH_ID_PARAM);
		scrubUrl(url.toString());
		return roomId ? { roomId, ...(id ? { pushId: id } : {}) } : undefined;
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

	/** Chromium's install prompt, from the push setting's Install app button: offered once. */
	async function installApp(): Promise<void> {
		const prompt = installPrompt;
		installPrompt = undefined;
		await prompt?.prompt().catch(() => undefined);
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
			if (chat) void clearView(chat.url);
			session.forget();
		};
	}

	function connected(): void {
		if (previewMode) return;
		if (client) recentServers = rememberServer(recentServers, client.url, backendHost(client.url) || undefined);
		connectOpen = false;
		offeringLink = false;
	}

	// --- Navigation and drafts ---

	/**
	 * Opens what the page's URL named, as far as this server shows it: the room
	 * (joined, or read without joining), then the thread under it once the
	 * room's threads are listed, then the message. Each step replaces the URL's
	 * history entry rather than adding one; the effect calls it again as each
	 * step lands.
	 */
	function openLinked(target: Destination & { room: string }): void {
		if (!client) return;
		const listed = (id: string) => session.rooms.some((room) => room.id === id);
		// Until it has all opened, the URL keeps naming the whole link, so a reload tries it again.
		const keepLink = () => scrubUrl(addressOf(target.room, target.thread, target.message));
		if (activeRoom?.id !== target.room) {
			if (!listed(target.room) && !client.viewRoom(target.room)) {
				// Not among the rooms to join either, once those are listed: this server doesn't show it here.
				if (session.snapshot.directory !== undefined || !session.canManageRooms) abandonLink('room');
				return;
			}
			session.chooseRoom(client, target.room);
			setDestination(target.room, undefined, 'replace');
			keepLink();
			return;
		}
		if (target.thread && activeThread !== target.thread) {
			if (!listed(target.thread) && !client.viewRoom(target.thread)) {
				// The room's threads are listed without it: the room is as far as the link goes.
				if (session.snapshot.threadDirectory[target.room] !== undefined || !session.canManageRooms) abandonLink('thread');
				return;
			}
			showThread(target.room, target.thread, 'replace');
			keepLink();
			return;
		}
		linked = undefined;
		if (target.message) void revealLinkedMessage(target.room, target.thread, target.message);
	}

	/** Part of a link isn't here: the URL says where the page is instead, and a toast says what wasn't found. */
	function abandonLink(missing: 'room' | 'thread' | 'message'): void {
		linked = undefined;
		feedback.error(`The linked ${missing} isn’t available here.`);
		scrubUrl(addressOf(selectedRoomId, activeThread));
	}

	/**
	 * Scrolls to a linked message in the open room or thread, paging back
	 * through its history until it is loaded: a `message_id` is the `log_id` it
	 * was created at (§2), so once what's loaded reaches back past that, it
	 * isn't here. Only the linked room or thread is searched.
	 */
	async function revealLinkedMessage(roomId: string, thread: string | undefined, id: string): Promise<void> {
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
			abandonLink('message');
			return;
		}
		await jumpToMessage(id);
		scrubUrl(addressOf(roomId, thread, id));
	}

	/** Waits, a frame at a time, until `ready` holds or `ms` pass. */
	async function until(ready: () => boolean, ms: number): Promise<void> {
		const started = performance.now();
		while (!ready() && performance.now() - started < ms) await new Promise((resolve) => requestAnimationFrame(resolve));
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

	/** Copies a link to a message: its room, the thread it's in, and the message itself. */
	async function copyMessageLink(event: MessageRecord): Promise<boolean> {
		const destination = destinationOf(event);
		if (!destination) return false;
		try {
			await navigator.clipboard.writeText(addressOf(destination.room, destination.thread, event.message_id));
			return true;
		} catch {
			feedback.error('Unable to copy the link');
			return false;
		}
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
	 * entry of its own: Back, the list's ›, or picking the open one again
	 * returns to it, and picking another takes the entry's place.
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
		selection.cancel();
		composer?.reset();
		mentions.clearUnseen();
		mentions.clearRoom(roomId);
		if (thread) mentions.clearRoom(thread);
		stickToBottom = true;
		reveal.from(timeline.length - FIRST_PAINT_ITEMS);
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
		setDestination(roomId, thread);
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

	/** Loads a thread's history (§4.3); a failure the client recorded is reported once. */
	function loadThread(roomId: string): void {
		client?.loadRoom(roomId).catch((cause: unknown) => {
			if (session.rooms.find((room) => room.id === roomId)?.recoveryError) feedback.error(cause, 'Unable to load thread');
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
		if (!client || !paneRoom) return;
		drafts.saveText();
		const roomId = paneRoom.id;
		client.sendTyping(roomId, true);
		if (typingTimer) clearTimeout(typingTimer);
		typingTimer = setTimeout(() => client?.sendTyping(roomId, false), 5000);
	}

	/**
	 * Sends the composer's text: a message with the draft's mentions (§3.5) and
	 * previews of its GitHub links as `link` embeds (§4.8.1), or
	 * with capability `command` a command (§4.1), which `/nick`, `/join`, `/leave`,
	 * `/topic`, `/kick` and `/invite` turn into the requests they spell. A
	 * command's failure shows as a local notice in the pane, where its replies
	 * land too.
	 */
	function sendMessage(): void {
		if (!client || !paneRoom || !canCompose) return;
		if (drafts.files.length) {
			void sendFiles();
			return;
		}
		if (!drafts.text.trim()) return;
		const chat = client;
		const draft = drafts.text;
		const roomId = paneRoom.id;
		const reply = drafts.reply;
		const originKey = draftKey(roomId);
		const mentions = composerMentions;
		const dismissed = composerDismissed;
		const action = composerAction(draft, { command: snapshot.capabilities.command, rooms: session.canManageRooms, members: !snapshot.memberChangesUnsupported }, mentions);
		// A draft given back keeps the link previews that were removed from it.
		const restore = () => {
			if (!drafts.restore(originKey, draft, reply)) return;
			composerDismissed = dismissed;
			composer?.focus();
		};
		const options = { ...(reply ? { replyTo: reply } : {}), ...(mentions.length ? { mentions } : {}) };
		if (action.kind === 'message') {
			if (!action.text.trim()) return;
			const embeds = linkPreviews.embeds(action.text, dismissed);
			const post = () => feedback.track(chat.send(roomId, action.text, 'markdown', { ...options, ...(embeds.length ? { embeds } : {}) }), 'Sending…', restore);
			const joining = joinFirst(chat, paneRoom);
			if (joining) {
				joining.then(post, (cause: unknown) => {
					feedback.error(cause, 'Unable to join the thread');
					restore();
				});
			} else {
				post();
			}
			stickToBottom = true;
			pins++;
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
		if (typingTimer) clearTimeout(typingTimer);
		composer?.focus();
	}

	/** `/join`: a room you're in opens; another, found by ID or title among those listed, is joined and opens once it arrives. */
	function joinByName(name: string, failed: (cause: unknown) => void): void {
		if (!client) return;
		const wanted = name.toLowerCase();
		const joined = session.rooms.find((room) => room.id === name) ?? session.rooms.find((room) => room.title.toLowerCase() === wanted);
		if (joined) {
			openMentionedRoom(joined.id);
			return;
		}
		const listed = [...(snapshot.directory ?? []), ...Object.values(snapshot.threadDirectory).flat()];
		const target = listed.find((listing) => listing.id === name) ?? listed.find((listing) => listing.title.toLowerCase() === wanted);
		pendingJoin = target?.id ?? name;
		client.joinRoom(pendingJoin).promise.catch(failed);
	}

	/**
	 * Attaches picked, pasted or recorded files to the open pane's draft
	 * (capability `embed:upload`), to go out when it is sent. Images start
	 * shrinking and losing their metadata right away; one that can't be
	 * readied is taken back off with the reason.
	 */
	function stageFiles(picked: File[]): void {
		if (!canCompose || !session.snapshot.capabilities['embed:upload']) return;
		const staged = picked.map((file): StagedFile => ({ id: `staged-${++stagedCount}`, file, prepared: prepareUpload(file) }));
		for (const { id, prepared } of staged) {
			prepared.catch((cause: unknown) => {
				drafts.unstage(id);
				feedback.error(cause, 'Unable to attach the file');
			});
		}
		drafts.stage(staged);
		composer?.focus();
	}

	/**
	 * Sends the draft with its staged files as upload embeds, with whatever is
	 * in the composer as the text; each file is written to the URL the server
	 * hands back, and the message shows it pending until then. A command
	 * takes them as arguments instead (§4.1). A failed send gives the draft
	 * back, files and all.
	 */
	async function sendFiles(): Promise<void> {
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
		const text = action.kind === 'message' ? action.text : draft;
		const mentions = composerMentions;
		const dismissed = composerDismissed;
		const embeds = command ? [] : linkPreviews.embeds(text, dismissed);
		const options = { ...(reply ? { replyTo: reply } : {}), ...(mentions.length ? { mentions } : {}), ...(embeds.length ? { embeds } : {}) };
		clearComposer(roomId);
		chat.sendTyping(roomId, false);
		if (typingTimer) clearTimeout(typingTimer);
		stickToBottom = true;
		pins++;
		composer?.focus();
		feedback.pending(staged.length === 1 ? `Uploading ${staged[0].title || staged[0].file.name || 'file'}…` : `Uploading ${staged.length} files…`);
		// A file that couldn't be readied was already taken off with its reason; the rest go.
		const readied = await Promise.allSettled(staged.map(({ prepared }) => prepared));
		// Each goes out under the name it was given on the draft, if it was renamed.
		const files = readied.flatMap((result, index) => (result.status === 'fulfilled' ? [{ ...result.value, ...(staged[index].title ? { title: staged[index].title } : {}) }] : []));
		const kept = staged.filter((_, index) => readied[index].status === 'fulfilled');
		const restore = () => {
			if (!drafts.restore(originKey, draft, reply, kept)) return;
			composerDismissed = dismissed;
			composer?.focus();
		};
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

	/** How long a side panel takes to slide open or shut: --slide-time in the CSS. */
	const SLIDE_MS = 240;
	let heldTimeline: { scroller: HTMLElement; width: number; release: () => void } | undefined;

	/**
	 * While a side panel slides, the conversation's width changes every frame. The timeline takes the width it will
	 * end at from the start instead, so its messages are laid out once, not re-wrapped on every frame, and the pane
	 * clips it meanwhile, on a compositor layer of its own (only then: it would hold fixed-position children). It
	 * lets go when the grid's slide ends, which a slow first frame (that one layout) can put well after the tap.
	 * `change` is how much wider the conversation is about to be.
	 */
	function prepareSlide(change: number): void {
		const scroller = messageScroll;
		const pane = scroller?.closest<HTMLElement>('.ap-shell-main');
		const app = pane?.parentElement;
		if (!scroller || !pane || !app || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const from = heldTimeline?.scroller === scroller ? heldTimeline.width : scroller.getBoundingClientRect().width;
		heldTimeline?.release();
		const width = from + change;
		scroller.style.width = `${width}px`;
		pane.style.overflow = 'clip';
		pane.style.willChange = 'transform';
		// Re-wrapped at its new width, the history is taller or shorter: still at the latest message if it was.
		if (stickToBottom) requestAnimationFrame(() => { if (stickToBottom) scrollToLatest(); });
		const ended = (event: TransitionEvent) => { if (event.target === app && event.propertyName === 'grid-template-columns') release(); };
		// Should the slide not run (or its end be missed), letting go later changes nothing: the width is the final one.
		const fallback = setTimeout(() => release(), SLIDE_MS * 4 + 1000);
		const release = () => {
			app.removeEventListener('transitionend', ended);
			clearTimeout(fallback);
			if (heldTimeline?.release !== release) return;
			heldTimeline = undefined;
			scroller.style.width = '';
			pane.style.overflow = '';
			pane.style.willChange = '';
		};
		app.addEventListener('transitionend', ended);
		heldTimeline = { scroller, width, release };
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
			if (change !== 0) prepareSlide(change);
		});
	});

	function toggleMemberList(): void {
		if (memberListWide) memberList.toggle();
		else memberListOverlay = !memberListOverlay;
	}

	// --- Rooms ---

	function joinRoom(roomId: string): void {
		if (!client) return;
		// Joining is a write where guests only read: they open the room through its history instead.
		if (session.readOnly) {
			openWithoutJoining(roomId);
			return;
		}
		pendingJoin = roomId;
		feedback.track(client.joinRoom(roomId), 'Joining…');
	}

	/**
	 * Opens a listed room or thread without joining it, read through its
	 * history (§4.3), for a guest on a server whose guests only read.
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
		const again = leaving.parentRoomId !== undefined ? 'from Other threads under its room' : 'from Browse rooms';
		if (!confirm(`Leave ${leaving.title}? You can join it again ${again}.`)) return;
		if (activeThread && activeRoom) backToRoom();
		feedback.track(client.leaveRoom(leaving.id), 'Leaving…');
	}

	/**
	 * Leaves a thread from its row in the sidebar, without asking: it only moves down to Other threads, where
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
	 * doesn't receive the broadcast: a reply in a thread read without joining
	 * joins it first, so the reply and what follows arrive.
	 */
	function joinFirst(chat: ChatClient, room: RoomSnapshot): Promise<unknown> | undefined {
		if (room.joined || !session.canManageRooms) return undefined;
		return chat.joinRoom(room.id).promise;
	}

	/** A room mention in a message was clicked: open it, or join it when you haven't. */
	function openMentionedRoom(roomId: string): void {
		const room = session.rooms.find((candidate) => candidate.id === roomId);
		if (!room) {
			if (session.canManageRooms) joinRoom(roomId);
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

	function replyPreview(id: string): { name?: string; text: string } {
		const target = resolveMessage(id);
		if (!target) return { text: 'Message unavailable' };
		if (target.deleted) return { text: 'Message deleted' };
		return { name: senderName(target), text: replySnippet(target) };
	}

	/** A message's reaction chips, from the timeline of the room it lives in. */
	function reactionsFor(event: MessageRecord): ReactionChip[] {
		const room = session.rooms.find((candidate) => candidate.id === event.room_id);
		return reactionChips(room?.timeline.reactions[event.message_id], session.you?.user_id, event.deleted === true, (user) => directory.name(user));
	}

	function react(event: MessageRecord, emoji: string): void {
		if (!client || !session.canReact || event.deleted) return;
		feedback.track(client.toggleReaction(event.message_id, emoji), 'Reacting…');
	}

	// --- Reading ---

	/** Where a message shows: a thread's messages in the thread, a room's own in the room. */
	function destinationOf(target: MessageRecord): { room: string; thread?: string } | undefined {
		const rooms = session.rooms;
		const home = rooms.find((room) => room.id === target.room_id);
		if (!home) return undefined;
		if (home.parentRoomId !== undefined && rooms.some((room) => room.id === home.parentRoomId)) return { room: home.parentRoomId, thread: home.id };
		return { room: home.id };
	}

	async function renderedMessage(id: string): Promise<HTMLElement | undefined> {
		await tick();
		const node = () => messageScroll?.querySelector<HTMLElement>(`article[data-message-id="${CSS.escape(id)}"]`) ?? undefined;
		await until(() => Boolean(node()), JUMP_WAIT_MS);
		return node();
	}

	/**
	 * Scrolls the timeline to a message and highlights it for a moment, first
	 * opening the room or thread it lives in (and loading a thread's history).
	 */
	async function jumpToMessage(id: string): Promise<void> {
		const target = resolveMessage(id);
		const destination = target ? destinationOf(target) : undefined;
		if (!destination) return;
		if (destination.room !== activeRoom?.id || destination.thread !== activeThread) {
			openDestination(destination.room, destination.thread);
			stickToBottom = false;
		}
		reveal.from(0);
		const node = await renderedMessage(id);
		if (!node) return;
		stickToBottom = false;
		node.scrollIntoView({ block: 'center' });
		node.focus({ preventScroll: true });
		highlightedId = id;
		if (highlightTimer) clearTimeout(highlightTimer);
		highlightTimer = setTimeout(() => (highlightedId = undefined), 1600);
	}

	/**
	 * Opens the pane at its New divider, near the top with what is new below
	 * it, as long as it still shows the latest: a jump, the reader, or sending
	 * may have moved it first. A thread first loads its older replies back to
	 * the divider (as a linked message's do), so the divider doesn't move up
	 * out of view as they load. Either way the pane has landed after.
	 */
	async function landAtDivider(roomId: string): Promise<void> {
		const visit = newDivider;
		if (landing === visit) return;
		landing = visit;
		const pinned = pins;
		const still = () => newDivider === visit && paneRoom?.id === roomId && stickToBottom && pins === pinned;
		try {
			const after = visit.after;
			for (let page = 0; page < LINKED_MESSAGE_PAGES && client && after !== undefined && still(); page++) {
				const oldest = paneRoom?.timeline.order[0];
				if (!paneRoom?.olderAvailable || oldest === undefined || compareLogIds(oldest, after) <= 0) break;
				try {
					await client.loadOlder(roomId);
				} catch {
					break;
				}
			}
			const before = newDividerBefore;
			if (before === undefined || !still()) return;
			const index = timeline.findIndex((item) => item.kind === 'message' && item.event.message_id === before);
			if (index >= 0 && index - LAND_CONTEXT_ITEMS < reveal.hidden) reveal.from(index - LAND_CONTEXT_ITEMS);
			await tick();
			const divider = () => messageScroll?.querySelector<HTMLElement>('.ap-divider-new') ?? undefined;
			await until(() => Boolean(divider()) || !still(), JUMP_WAIT_MS);
			const node = divider();
			const scroller = messageScroll;
			if (!node || !scroller || !still()) return;
			stickToBottom = false;
			scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - LAND_MARGIN_PX;
			lastScrollTop = scroller.scrollTop;
			// Settled here, not by the next scroll event or intersection, so nothing reads the pane as at its latest meanwhile.
			stickToBottom = atLatest(scroller);
			const items = scroller.querySelectorAll<HTMLElement>('[data-timeline-item]');
			const latest = items[items.length - 1]?.getBoundingClientRect();
			latestVisible = !latest || latest.top < scroller.getBoundingClientRect().bottom;
			latestVisibleIn = roomId;
			if (!latestVisible) seenThrough = after;
		} finally {
			if (landing === visit) landing = undefined;
			if (newDivider === visit) newDivider = { ...visit, landed: true };
		}
	}

	function jumpToLatest(): void {
		stickToBottom = true;
		pins++;
		mentions.clearUnseen();
		scrollToLatest();
	}

	/** Whether the list is scrolled to (near enough) its end. */
	function atLatest(scroller: HTMLElement): boolean {
		return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
	}

	function scrollToLatest(): void {
		if (!messageScroll) return;
		messageScroll.scrollTop = messageScroll.scrollHeight;
		lastScrollTop = messageScroll.scrollTop;
	}

	/** Takes you to the oldest mention that arrived while you were reading back. */
	function jumpToMention(): void {
		const target = mentions.takeUnseen();
		if (target) void jumpToMessage(target);
		else jumpToLatest();
	}

	function trackScroll(): void {
		if (!messageScroll) return;
		const top = messageScroll.scrollTop;
		const scrolledUp = lastScrollTop === undefined || top < lastScrollTop - 1;
		lastScrollTop = top;
		// While pinned, only the reader scrolling up lets go. The pane grows under us as a room's
		// history, its threads' cards and long messages lay out; our own scroll's event can land
		// after that, and scroll anchoring moves the list down, before the next frame catches up.
		if (stickToBottom && !scrolledUp) {
			requestAnimationFrame(() => {
				if (stickToBottom) scrollToLatest();
			});
			return;
		}
		const atBottom = atLatest(messageScroll);
		if (top < OLDER_REPLIES_MARGIN_PX) void loadOlderReplies();
		if (!atBottom && stickToBottom) seenThrough = messages[messages.length - 1]?.message_id;
		stickToBottom = atBottom;
		floatingDay.update(messageScroll, atBottom);
	}

	/**
	 * A thread opens on its newest replies; reading back near the top loads the
	 * page before them. The reader's place is kept: whatever was on screen stays
	 * put while the older replies land above it.
	 */
	async function loadOlderReplies(): Promise<void> {
		const room = threadRoom;
		if (!client || !room || !messageScroll || !room.olderAvailable || room.loadingOlder) return;
		const scroller = messageScroll;
		const height = scroller.scrollHeight;
		const top = scroller.scrollTop;
		try {
			await client.loadOlder(room.id);
		} catch {
			return; // The next scroll back tries again.
		}
		await tick();
		keepPlace(scroller, top, height);
	}

	/**
	 * Older items landed above: keeps what was on screen in place, given the
	 * list's scroll top and height from before, unless the pane follows the
	 * latest. Where the browser anchored the view itself this is already the position.
	 */
	function keepPlace(scroller: HTMLElement | undefined, top: number, height: number): void {
		if (!scroller || messageScroll !== scroller || stickToBottom) return;
		scroller.scrollTop = top + (scroller.scrollHeight - height);
		lastScrollTop = scroller.scrollTop;
	}

	// --- Editing ---

	/**
	 * Any message in the open pane can be picked for a move (capability `edit`), anyone's:
	 * the server decides whose it lets you move, and a refusal moves none (MessageSelection.move).
	 */
	function canSelect(event: MessageRecord): boolean {
		return session.canEdit && !event.deleted && event.room_id === paneRoom?.id;
	}

	/** Whether a picked message is yours, which the server always lets you move. */
	function ownMessage(id: string): boolean {
		const event = resolveMessage(id);
		return event !== undefined && isOwn(event, session.you);
	}

	/** Whether you may move a picked message to a new thread: yours, or anyone's for an admin or a mod. */
	function movable(id: string): boolean {
		const event = resolveMessage(id);
		return event !== undefined && mayMove(event, session.you);
	}

	/**
	 * Who comes along when picked messages move into a thread: each moved
	 * message's author not in it yet is added to it (§4.2.2), so they still
	 * see their messages. Only where this viewer may add people: with
	 * `server.ext.settings.add_members` on, or as an admin.
	 */
	function moveAuthors(): MoveAuthors | undefined {
		if (!canChangeMembers || session.snapshot.memberChangesUnsupported) return undefined;
		if (!serverSettings(session.server).add_members && !session.you?.roles?.includes('admin')) return undefined;
		return {
			of: (id) => resolveMessage(id)?.from?.user_id,
			skip: (userId, room) => userId === session.you?.user_id || Boolean(session.rooms.find((other) => other.id === room)?.members?.some((member) => member.user_id === userId))
		};
	}

	/** What the toolbar offers: only what the server can do, and only on messages this viewer may change. */
	function capsFor(event: MessageRecord): MessageCaps {
		const own = session.canEdit && isOwn(event, session.you);
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

	/** Saves an edit: the new text, and any embeds removed or renamed in the editor, together. */
	function saveEdit(event: MessageRecord, text: string, edits?: EmbedEdits): void {
		if (!client || !session.canEdit) return;
		feedback.track(client.editMessage(event.message_id, text, undefined, edits), 'Saving edit…');
		editingId = undefined;
	}

	function deleteMessage(event: MessageRecord): void {
		if (!client || !session.canEdit) return;
		if (!confirm('Delete this message? This cannot be undone.')) return;
		feedback.track(client.deleteMessage(event.message_id), 'Deleting message…');
	}

	/** The (x) on one of your embeds: saves the message without it. Hosted files go with it, so those ask first. */
	function removeEmbed(event: MessageRecord, embed: Embed): void {
		if (!client || !session.canEdit) return;
		if ((embed.kind === 'upload' || embed.kind === 'stream') && !confirm('Remove this attachment? Its file will be deleted.')) return;
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
		if (room.id === activeRoom?.id) askNewThread({ title: '', summary: '' });
	}

	/**
	 * Start thread on a message: the dialog suggests the message's first line
	 * as the title and begins the summary with the message quoted. Threads
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
		askNewThread({ title: threadTitleFor(event), summary: threadSummaryFor(event) ?? '', message: id });
	}

	/**
	 * Creates the thread the NewThreadDialog asked for (§4.2.4), the summary as
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
				check: (threadId) => threadLostPrivacy(session.rooms, roomId, threadId) ? new Error(PRIVACY_LOST) : undefined,
				own: ownMessage,
				movable,
				authors: moveAuthors()
			});
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
		pendingOpen = { room: roomId, thread: result.room_id, ...(start.message !== undefined ? { replyTo: start.message } : {}) };
	}

	// --- Select mode ---

	function beginSelect(event: MessageRecord): void {
		if (!paneRoom || !canSelect(event)) return;
		editingId = undefined;
		composer?.reset();
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
		askNewThread({ title: threadTitleFor(first !== undefined ? resolveMessage(first) : undefined), summary: '', moving: selection.ids.length });
	}

	/** Escape leaves select mode, as it leaves the thread menu. */
	/**
	 * Files pasted while focus is outside any field (on the timeline, say)
	 * attach to the draft, as they would pasted into the composer.
	 */
	function windowPaste(event: ClipboardEvent): void {
		if (event.defaultPrevented || !canAttach) return;
		const target = event.target;
		if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
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

	function windowKeydown(event: KeyboardEvent): void {
		// Escape in the NewThreadDialog closes it and keeps the selection it was asked for.
		if (event.key !== 'Escape' || !selection.active || newThread) return;
		if (selection.menuOpen) {
			selection.menuOpen = false;
			return;
		}
		selection.cancel();
		composer?.focus();
	}
</script>

<svelte:window onkeydown={windowKeydown} onpaste={windowPaste} ondragover={refuseDrop} ondrop={refuseDrop} onfocus={() => { presence.focus(); refreshNotificationPermission(); }} onblur={() => presence.blur()} />
<svelte:document onvisibilitychange={() => { presence.visibilityChanged(); refreshNotificationPermission(); if (document.visibilityState === 'hidden') keepView(); }} />

<svelte:head>
	<title>{tabTitle(unread.total, presence.titleFlash)}</title>
	<meta name="description" content="Apron, a chat frontend for the Apron Chat Protocol." />
</svelte:head>

{#if client && askedLink}
	<!-- Signed in here, guests too, where a link can add a way in (`addAs`): the link may have been sent for that. -->
	<SignInLinkDialog
		link={askedLink}
		current={{
			url: client.url, keptSession: Boolean(snapshot.keptSession),
			...(askedLink.server && askedLink.server !== client.url ? { targetKeptSession: client.keptSessionFor(askedLink.server) } : {}),
			...(snapshot.passkeySession && session.you ? { signedInAs: session.you.name ? `${session.you.name} (@${session.you.user_id})` : `@${session.you.user_id}` } : {}),
			...(snapshot.authenticated && snapshot.you && snapshot.server?.auth.some((scheme) => scheme === 'email' || scheme === 'external') ? { addAs: snapshot.you.name ? `${snapshot.you.name} (@${snapshot.you.user_id})` : `@${snapshot.you.user_id}` } : {})
		}}
		onconfirm={() => askedLink && useLink({ kind: 'ask', link: askedLink })} onadd={() => askedLink && addAskedLink(askedLink)} oncancel={() => (askedLink = undefined)}
	/>
{/if}
{#if !client}
	<div class="app ap-shell ap-shell-norail"></div>
{:else if connectOpen}
	<ConnectScreen
		{client} {session} bind:serverInput bind:displayName {passkeyUnavailable} {recentServers}
		canCancel={session.rooms.length > 0 || session.ready || offeringLink} initialScheme={connectScheme}
		initialError={linkFailure?.error}
		onconnect={leaveBackend} onconnected={connected} oncancel={() => { connectOpen = false; offeringLink = false; if (client) serverInput = client.url; }} onsignout={signedOut}
	/>
{:else}
<div
	class="app ap-shell ap-shell-norail"
	class:slides={slidesReady}
	class:side-collapsed={sidebar.collapsed}
	class:side-resizing={sidebar.resizing || memberList.resizing}
	class:member-list-open={memberListOpen}
	class:member-list-wide={memberListWide}
	data-pane={mobilePane}
	style:--sidebar-w="{roomsTrack}px"
	style:--rooms-w="{sidebar.width}px"
	style:--member-list-w="{memberList.width}px"
	style:--member-list-track="{membersTrack}px"
>
	<PanelToggle side="left" panel="rooms" open={!sidebar.collapsed} ontoggle={() => sidebar.toggle()} />
	<Sidebar
		{client} {session} {backendLabel} threads={listedThreads} {activeThread} mentions={mentions.byRoom} unread={unread.byRoom} bind:displayName {passkeyUnavailable}
		notificationsEnabled={notificationsActive} notificationsSupported={notificationState !== 'unsupported'} notificationPermission={notificationState} notifyScopes={notifyScopes} onnotifications={toggleNotifications} onnotifyscopes={setNotifyScopes} ontestnotifications={testNotifications}
		webPush={webPushKey(session.server) ? { supported: webPushAvailable, homeScreen: !webPushAvailable && needsHomeScreen(), enabled: webPushActive && !webPushHeldBy, ...(webPushHeldBy ? { heldBy: webPushHeldBy } : {}), ...(webPushServerKey ? {} : { signIn: true }), offered: webPushOffered, installable: canOfferInstall(installPrompt), ...(webPushError && webPushServerKey ? { error: webPushError } : {}) } : undefined} onwebpush={pushHere} oninstallapp={installApp}
		pause={canPause ? { ...(pausedUntil !== undefined && isPaused(pausedUntil) ? { until: pausedUntil } : {}) } : undefined} onpause={pauseNotifications} onresume={() => client?.setMute(false) ?? Promise.resolve()}
		onconnect={() => openConnect()} onsignin={(name, scheme) => openConnect({ scheme: scheme ?? 'webauthn', name })}
		returnTo={activeRoom ? (activeThread ? threadTitle(activeThread) : activeRoom.title) : undefined} onreturn={closeRooms}
		onroom={chooseRoom} onthread={chooseThread} onopenthread={openThreadCard} onjoin={joinRoom} onleavethread={leaveThread} oncreateroom={(roomId, options) => { pendingJoin = roomId; pendingPrivate = options.private; }} onnewthread={newThreadInRoom} onsignout={signedOut}
	/>
	<SidebarHandle layout={sidebar} />
	<!-- The first-mention offer, pointing at Preferences while the rooms list (and its gear) shows; above the composer otherwise. -->
	<div class="notify-anchored" aria-live="polite">
		{#if notifyOffer}<NotifyPrompt {...notifyOffer} whenClosed={webPushAvailable && Boolean(webPushServerKey)} pointer onaccept={acceptNotifyOffer} ondecline={declineNotifyOffer} />{/if}
	</div>

	<main class="ap-shell-main" aria-label="Conversation" use:fileDrop={{ enabled: canAttach, onfiles: stageFiles, onactive: (active) => (dropping = active) }}>
		{#if dropping}
			<div class="drop-zone" data-testid="drop-zone" aria-hidden="true"><span>Drop files to attach</span></div>
		{/if}
		{#if activeRoom}
			<RoomHeader
				room={activeRoom}
				pane={paneRoom ?? activeRoom}
				showTopic={!pinnedSummary}
				onsummary={summaryPutAway ? () => { if (editTarget) hiddenSummaries = showSummary(hiddenSummaries, draftKey(editTarget.id)); } : undefined}
				threadTitle={activeThread ? threadTitle(activeThread) : undefined}
				typing={typingNames}
				replyCount={activeThread ? threadReplyCount : undefined}
				moreReplies={Boolean(activeThread && threadRoom?.olderAvailable)}
				canEdit={canEditPane}
				editDisabled={!paneReady}
				canLeave={session.canManageRooms && !session.readOnly && Boolean(paneRoom?.joined)}
				canJoin={session.canManageRooms && !session.readOnly && Boolean(paneRoom) && !paneRoom?.joined}
				{memberListOpen}
				memberListToggle={!memberListWide}
				{unreadElsewhere}
				{mentionsElsewhere}
				onback={openRooms} onroom={backToRoom} onedit={() => (roomEditorOpen = true)} onleave={leavePane} onjoin={joinPane} onmemberlist={toggleMemberList}
			/>
			{#if roomEditorOpen && editTarget}
				{#key editTarget.id}
					<RoomEditor {client} room={editTarget} thread={Boolean(activeThread)} enabled={canCompose && session.canManageRooms} onclose={() => (roomEditorOpen = false)} />
				{/key}
			{/if}

			{#if session.connection === 'reconnecting' && !session.reconnectNeedsAttention}
				<!-- A short blip stays quiet: the room, history, and identity are kept in place, and the pill above the composer says it. -->
				<span class="sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
			{:else if session.starting && session.connection === 'connecting'}
				<!-- Coming up with a view from before: the timeline's foot says it's checking; a banner would only alarm. -->
				<span class="sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
			{:else if session.connection !== 'connected'}
				<div class="banner">
					<StatusBanner tone={session.connection === 'connecting' ? 'warn' : 'danger'} testid="connection-status" live>
						{statusLabel(snapshot, session.stalled)}
						{#snippet action()}
							{#if session.reconnectNeedsAttention}
								<button class="ap-btn ap-btn-sm" type="button" data-testid="reconnect-retry" disabled={Boolean(snapshot.retryAfterMs)} onclick={signInAgain}>{snapshot.held ? 'Sign in' : 'Try Again'}</button>
							{/if}
						{/snippet}
					</StatusBanner>
				</div>
			{:else}
				<span class="sr" data-testid="connection-status" role="status" aria-live="polite">Connected</span>
			{/if}
			{#if activeThread && !activeThreadEntry}
				<div class="banner">
					<StatusBanner tone="danger">
						This thread is no longer available on the server.
						{#snippet action()}<button class="ap-btn ap-btn-sm" type="button" onclick={backToRoom}>Back to room</button>{/snippet}
					</StatusBanner>
				</div>
			{/if}

			{#if pinnedSummary}
				{@const pinned = pinnedSummary}
				{#key pinned.id}
					<ThreadSummary description={pinned.description} thread={Boolean(activeThread)} onopenroom={openMentionedRoom} ondismiss={() => (hiddenSummaries = hideSummary(hiddenSummaries, draftKey(pinned.id), pinned.description))} />
				{/key}
			{/if}

			<div class="ap-timeline" bind:this={messageScroll} onscroll={trackScroll} data-testid="message-list" role="log" aria-live="polite" aria-label={`${activeThread ? threadTitle(activeThread) : activeRoom.title} messages`}>
				<div class="day-float" class:day-float-shown={floatingDay.shown} aria-hidden="true" data-testid="floating-day"><span>{floatingDay.label}</span></div>
				{#if snapshot.showReconnectDivider}
					<div class="ap-divider ap-divider-gap" role="separator" data-testid="reconnect-divider"><span>Reconnected · earlier messages aren’t available</span></div>
				{/if}
				<!-- No messages yet: placeholders, not thread cards on their own. -->
				{#if (messages.length === 0 || paneHeldBack) && paneCatchingUp}
					<TimelineLoading label={activeThread ? 'Loading replies…' : 'Loading messages…'} rows={activeThread ? 3 : 6} />
				{:else if timeline.length === 0}
					<div class="empty">
						<h2>{activeThread ? 'No replies yet' : 'Nothing here yet'}</h2>
						<p>{activeThread ? 'Reply below to continue the thread.' : `Start the conversation in ${activeRoom.title}.`}</p>
					</div>
				{:else}
					{#each shownTimeline as item (item.key)}
						{#if item.kind === 'date'}
							<div class="ap-divider ap-divider-date" role="separator"><span>{item.label}</span></div>
						{:else if item.kind === 'thread'}
							<ThreadCard entry={item.entry} unread={unread.byRoom[item.entry.id]} mentions={mentions.byRoom[item.entry.id]} onopen={() => openThreadCard(item.entry.id)} />
						{:else if item.kind === 'notice'}
							<NoticeLine notice={item.notice} onopenroom={openMentionedRoom} />
						{:else if item.kind === 'members'}
							<MembershipLine joined={item.joined} left={item.left} logId={item.logId} />
						{:else if item.kind === 'renamed'}
							<div data-timeline-item class="ap-msg ap-msg-system" data-testid="thread-renamed">
								<div class="ap-msg-system-body">{#if item.title}Thread renamed to <span class="ap-msg-text">“{item.title}”</span>{:else}Thread name cleared{/if}</div>
								{#if idTime(item.logId)}<time class="ap-msg-system-time" datetime={idIso(item.logId)} title={idDateTime(item.logId)}>{idTime(item.logId)}</time>{/if}
							</div>
						{:else}
							{@const event = item.event}
							{#if event.message_id === newDividerBefore}
								<div class="ap-divider ap-divider-new" role="separator" data-testid="new-divider"><span>New</span></div>
							{/if}
							<Message
								{event}
								grouped={item.grouped}
								resolve={resolveMessage}
								reactions={reactionsFor(event)}
								uploads={snapshot.uploads}
								mention={mentionsMe(event, session.you)}
								pinged={mentions.pinged.includes(event.message_id)}
								highlighted={highlightedId === event.message_id}
								selecting={selection.active}
								selected={selection.has(event.message_id)}
								editing={editingId === event.message_id}
								caps={capsFor(event)}
								onreply={() => beginReply(event)}
								onjump={jumpToMessage}
								onopenroom={openMentionedRoom}
								onedit={() => (editingId = event.message_id)}
								onsave={(text, edits) => saveEdit(event, text, edits)}
								oncanceledit={() => (editingId = undefined)}
								ondelete={() => deleteMessage(event)}
								onremovereply={() => removeReply(event)}
								onremoveembed={(embed) => removeEmbed(event, embed)}
								onstartthread={() => startThread(event)}
								oncopylink={() => copyMessageLink(event)}
								onreact={(emoji) => react(event, emoji)}
								onbeginselect={() => beginSelect(event)}
								onselect={(range) => selection.toggle(event.message_id, selectableOrder, range)}
							/>
						{/if}
					{/each}
				{/if}
			</div>

			{#if timeline.length > 0 && !latestVisible}
				<JumpBar count={unseenCount} mentions={mentions.unseen.length} onjump={jumpToLatest} onjumpmention={jumpToMention} />
			{/if}

			<div class="notify-inline" aria-live="polite">
				{#if notifyOffer}<NotifyPrompt {...notifyOffer} whenClosed={webPushAvailable && Boolean(webPushServerKey)} onaccept={acceptNotifyOffer} ondecline={declineNotifyOffer} />{/if}
			</div>
			<div class="ap-typing typing-row" aria-live="polite">
				{#if typingNames.length > 0}
					<TypingDots />
					{typingLine(typingNames)}
				{/if}
			</div>
			<!-- Floats just above the composer, in the gap under the last message, rather than taking a line: nothing moves. -->
			{#if checkingShown && timeline.length > 0}<TimelineLoading float label={quietReconnect ? statusLabel(snapshot, session.stalled) : activeThread ? 'Checking for new replies…' : 'Checking for new messages…'} />{/if}

			{#if selection.active}
				<SelectionBar
					{selection} threads={selectThreads} parentRoom={activeThread ? activeRoom.id : undefined} canCreateThread={canStartThreads}
					onmove={(room) => moveSelection(room)} onnewthread={newThreadFromSelection} onfill={() => selection.fillBetween(selectableOrder)}
					oncancel={() => { selection.cancel(); composer?.focus(); }}
				/>
			{:else if session.readOnly}
				<ReadOnlyBar {passkeyUnavailable} onsignin={() => openConnect({ signIn: true })} />
			{:else}
				<Composer
					bind:this={composer}
					bind:value={drafts.text}
					bind:mentions={composerMentions}
					bind:dismissed={composerDismissed}
					placeholder={activeThread ? `Reply in ${threadTitle(activeThread)}` : `Message ${activeRoom.title}`}
					disabled={!canCompose}
					canUpload={snapshot.capabilities['embed:upload']}
					canUploadAudio={!snapshot.imageOnlyUploads}
					canCommand={snapshot.capabilities.command}
					{people}
					rooms={roomSuggestions}
					reply={drafts.reply ? replyPreview(drafts.reply) : undefined}
					oninput={composerInput} onsend={sendMessage} files={drafts.files} onfiles={stageFiles} onunstage={(id) => drafts.unstage(id)} onrename={(id, title) => drafts.rename(id, title)} oncancelreply={cancelReply}
					onmention={() => listMembers(MEMBERS_FRESH_MS)}
				/>
			{/if}
		{:else if session.starting}
			<!-- Coming up (connecting, signing in, listing rooms): placeholders where the room will be, not "No room open". -->
			<div class="starting">
				<header class="ap-roomhead"><span class="ap-skel starting-title" aria-hidden="true"></span></header>
				<div class="ap-timeline starting-timeline">
					<span class="sr" data-testid="connection-status" role="status" aria-live="polite">{statusLabel(snapshot, session.stalled)}</span>
					<TimelineLoading label={session.connection === 'connected' ? 'Loading messages…' : 'Connecting…'} rows={6} />
				</div>
			</div>
		{:else}
			<div class="empty empty-room">
				{#if session.connection !== 'connected'}
					<StatusBanner tone={session.connection === 'offline' ? 'danger' : 'warn'} testid="connection-status" live>{statusLabel(snapshot, session.stalled)}</StatusBanner>
				{:else}
					<span class="sr" data-testid="connection-status" role="status" aria-live="polite">Connected</span>
					<h2>No room open</h2>
					<p>Pick a room from the list.</p>
				{/if}
				<button class="ap-btn ap-btn-sm" type="button" onclick={() => openConnect()}>Connect to a backend</button>
			</div>
		{/if}
	</main>
	<!--
		Outside the conversation pane, which a phone hides while the room list shows: a modal there doesn't render,
		so the + on a room's row would open nothing. It floats over whichever pane is up; the new thread opens in the
		conversation pane once it exists.
	-->
	{#if newThread}
		{@const start = newThread}
		{#key start}
			<NewThreadDialog room={start.room} title={start.title} summary={start.summary} moving={start.moving}
				enabled={canStartThreads && canCompose && (!start.moving || session.canEdit)}
				oncreate={(thread) => createThread(start, thread)} onclose={() => (newThread = undefined)} />
		{/key}
	{/if}
	{#if memberListWide}<PanelToggle bind:this={memberListToggle} side="right" panel="member list" open={memberListOpen} ontoggle={toggleMemberList} />{/if}
	<MemberListSidebar {client} {session} room={paneRoom} open={memberListOpen} canChange={canChangeMembers} />
	<ProfileCard {client} {session} room={paneRoom} canChange={canChangeMembers} canMention={Boolean(composer) && canCompose && !selection.active} onmention={(userId) => composer?.mention(userId)} />
	<ReactorsPopover />
	<!-- Kept through a drag that collapses the list, so the drag still ends on it. -->
	<!-- Kept while shut (hidden), so its border slides with the list's. -->
	{#if memberListWide}<SidebarHandle layout={memberList} name="member list" oncollapse={() => memberListToggle?.focus()} />{/if}

	<!-- An error stays until closed or the next request; a pending line goes by itself. -->
	{#snippet close(label: string, onclose: () => void)}
		<button class="ap-iconbtn toast-close" type="button" aria-label={label} title="Dismiss" onclick={onclose}><X size={14} aria-hidden="true" /></button>
	{/snippet}
	{#if feedback.current}
		{@const error = feedback.current.kind === 'error'}
		<div class="toast">
			<StatusBanner tone={error ? 'danger' : 'warn'} role={error ? 'alert' : 'status'} action={error ? dismissFeedback : undefined}>{feedback.current.text}</StatusBanner>
		</div>
	{/if}
	{#snippet dismissFeedback()}{@render close('Dismiss', () => feedback.clear())}{/snippet}
	<!-- While reconnecting, the banner at the top already says what went wrong (statusLabel). -->
	{#if snapshot.error && snapshot.error !== dismissedError && session.connection !== 'reconnecting'}
		<div class="toast toast-right">
			<StatusBanner tone="danger" role="alert" action={dismissClientError}>{snapshot.error}</StatusBanner>
		</div>
	{/if}
	{#snippet dismissClientError()}{@render close('Dismiss connection error', () => (dismissedError = snapshot.error))}{/snippet}
</div>
{/if}

<style>
	/* App glue over the Apron design system: layout height, the sidebar's collapse and the
	   phone's one-pane-at-a-time. Everything else is ap-* from apron.css, inside the components. */
	:global(html), :global(body) { height: 100%; }
	:global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }
	:global(button), :global(input), :global(textarea), :global(select) { font: inherit; }
	/*
	 * --corner: how far a header's content keeps clear of a PanelToggle in the window's corner.
	 * --slide: how both side panels open and shut. Their grid columns move (the grid's own transition, not an
	 * inherited variable, so nothing else restyles each frame); each panel's contents keep their width against its
	 * inner edge, so they ride the moving border rather than squeeze, and fade; the timeline keeps its final width
	 * meanwhile (prepareSlide). A drag follows the pointer instead.
	 */
	.app { --corner: calc(var(--space-3) + 28px + var(--space-2)); --slide-time: 240ms; --slide-ease: cubic-bezier(0.2, 0, 0, 1); height: 100dvh; min-height: 100%; position: relative; overflow: clip; }
	.slides { transition: grid-template-columns var(--slide-time) var(--slide-ease); }
	/*
	 * While an on-screen keyboard is up (trackKeyboard), the app is the part of the page above it: its header stays at
	 * the top and the composer sits on the keyboard, rather than the browser panning the page up under the status bar.
	 * Fixed, so it stays put however the browser scrolls the page behind it; moved down as far as the browser panned
	 * (by top, not a transform, which would make it the box its own fixed popovers are placed in).
	 */
	:global(html[data-keyboard]) .app { position: fixed; top: var(--app-top); left: 0; right: 0; height: var(--app-height); min-height: 0; }
	:global(html[data-keyboard]) .app :global(.ap-composer) { margin-bottom: var(--space-2); }
	/* The rooms list's toggle sits over its header, then over the room's once it's shut: the room's keeps clear of it. */
	.app :global(.ap-shell-sidehead) { padding-left: var(--corner); }
	.side-collapsed :global(.ap-roomhead) { padding-left: var(--corner); }
	/* With a column of its own, the member list's toggle sits over its header, then over the room's. */
	.member-list-wide :global(.member-list-head) { padding-right: var(--corner); }
	.member-list-wide:not(.member-list-open) :global(.ap-roomhead) { padding-right: var(--corner); }
	.slides :global(.ap-roomhead) { transition: padding var(--slide-time) var(--slide-ease); }
	/* Each panel's contents keep its open width, against the edge that faces the conversation. */
	.app :global(.ap-shell-side) { align-items: flex-end; }
	.app :global(.ap-shell-side > *) { width: calc(var(--rooms-w) - 1px); }
	.member-list-wide :global(.member-list) { overflow: hidden; align-items: flex-start; }
	.member-list-wide :global(.member-list > *) { width: calc(var(--member-list-w) - 1px); }
	/* Shut, a panel fades as it slides, then hides (from the keyboard and screen readers too). */
	.slides :global(.ap-shell-side), .slides.member-list-wide :global(.member-list) { transition: opacity var(--slide-time) var(--slide-ease), visibility 0s; }
	.side-collapsed :global(.ap-shell-side), .member-list-wide:not(.member-list-open) :global(.member-list) { opacity: 0; visibility: hidden; }
	.slides.side-collapsed :global(.ap-shell-side), .slides.member-list-wide:not(.member-list-open) :global(.member-list) { transition: opacity var(--slide-time) var(--slide-ease), visibility 0s var(--slide-time); }
	.side-resizing, .side-resizing :global(.ap-shell-side), .side-resizing :global(.member-list), .side-resizing :global(.ap-roomhead) { transition: none; }
	.side-resizing, .side-resizing :global(*) { user-select: none; }
	.banner { padding: var(--space-2) var(--space-4) 0; }
	/* Over the conversation while files are dragged onto it; drag events pass through to the pane. */
	.drop-zone {
		position: absolute; inset: var(--space-2); z-index: 20; display: grid; place-items: center;
		border: 2px dashed var(--accent); border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--bg-100) 85%, transparent); color: var(--ink);
		font-weight: 600; pointer-events: none;
	}
	.sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	.starting { flex: 1; display: flex; flex-direction: column; min-height: 0; }
	.starting-title { width: 120px; height: 14px; }
	.starting-timeline { display: flex; flex-direction: column; }
	.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-8); color: var(--ink-muted); text-align: center; }
	.empty h2 { margin: 0; font-size: var(--text-title); line-height: 24px; font-weight: 600; color: var(--ink); }
	.empty p { margin: 0; }
	.empty .ap-btn { margin-top: var(--space-2); }
	.typing-row { min-height: 20px; padding-top: var(--space-1); }
	/*
	 * The first-mention offer. Over the rooms list's foot, pointing at the Preferences gear (32px, its center 25px in
	 * from the list's right edge): its left edge 8px in, or further right on a list wider than it, to reach the gear.
	 */
	.notify-anchored { --notify-left: max(var(--space-2), calc(var(--sidebar-w) - 300px - var(--space-2))); position: absolute; z-index: 7; left: var(--notify-left); bottom: calc(var(--header-h) + 10px); width: 300px; max-width: calc(100vw - var(--space-4)); display: none; }
	.notify-anchored :global(.ap-nudge) { --ap-nudge-tip: calc(var(--sidebar-w) - 30px - var(--notify-left)); }
	.notify-inline { padding: 0 var(--space-4); }
	.notify-inline:not(:empty) { padding-top: var(--space-2); }
	.notify-inline :global(.ap-nudge) { width: auto; }
	@media (min-width: 720px) {
		.app:not(.side-collapsed) .notify-anchored { display: block; }
		.app:not(.side-collapsed) .notify-inline { display: none; }
	}
	/* A zero-height sticky row, so the pill floats over the timeline without taking space. */
	.day-float { position: sticky; top: var(--space-2); z-index: 2; height: 0; display: flex; align-items: flex-start; justify-content: center; pointer-events: none; }
	.day-float span { padding: 3px var(--space-3); border-radius: var(--radius-full); background: var(--bg-200); border: 1px solid var(--line); box-shadow: var(--shadow-float); color: var(--ink); font-size: var(--text-sm); line-height: 16px; font-weight: 500; white-space: nowrap; opacity: 0; transform: translateY(-4px); transition: opacity .2s, transform .2s; }
	.day-float-shown span { opacity: 1; transform: none; }
	@media (prefers-reduced-motion: reduce) {
		.day-float span { transition: none; transform: none; }
		.app, .app :global(.ap-shell-side), .app :global(.member-list), .app :global(.ap-roomhead) { transition: none; }
	}
	.toast { position: fixed; z-index: 10; left: 50%; bottom: calc(var(--space-4) + 64px); transform: translateX(-50%); max-width: min(480px, calc(100% - var(--space-8))); }
	.toast :global(.ap-status) { box-shadow: var(--shadow-float); }
	.toast-right { left: auto; right: var(--space-4); transform: none; }
	/* Smaller than an icon button, so a toast that can be closed is no taller than one that can't. */
	.toast-close { width: 22px; height: 22px; margin: -2px 0; flex: none; }

	/* Wide screens give an open member list its own column; narrower ones overlay it. */
	@media (min-width: 960px) {
		/* Its column is there while shut too, at 0, so it can slide. */
		.app.member-list-wide { grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--member-list-track); }
	}
	/* Under 720px it's one pane at a time: rooms, then the room or thread, pushed like pages. */
	@media (max-width: 719px) {
		.app { grid-template-columns: minmax(0, 1fr); }
		/* Phones go back to the rooms list instead. */
		.app > :global(.panel-toggle.left) { display: none; }
		.app :global(.ap-shell-sidehead) { padding-left: var(--space-4); }
		.app :global(.ap-roomhead) { padding-left: var(--space-4); }
		.app :global(.ap-shell-side) { align-items: stretch; }
		.app :global(.ap-shell-side > *) { width: auto; }
		.app[data-pane='main'] :global(.ap-shell-side) { display: none; }
		.app[data-pane='rooms'] .ap-shell-main, .app[data-pane='rooms'] :global(.member-list) { display: none; }
		.side-collapsed :global(.ap-shell-side), .slides.side-collapsed :global(.ap-shell-side) { opacity: 1; visibility: visible; transition: none; }
		.typing-row { display: none; }
		.toast-right { right: var(--space-4); left: var(--space-4); max-width: none; }
	}
</style>
