import type { RoomSnapshot } from '$lib/protocol/client';
import type { Identity, MessageRecord } from '$lib/protocol/types';
import { notificationsByRoom } from './incoming-messages';
import { senderName } from './messages';
import { inMutedRoom, inNotifyScopes } from './notify-scopes';

/**
 * What the page alerts about as messages arrive: the mentions you'd hear
 * (which chime and flash the tab), the offer to turn notifications on at the
 * first of them, and the desktop notifications to show while you're away.
 * The page runs it after each snapshot and acts on the answer.
 */

/** The page's view, as it alerts from it. */
export interface AlertView {
	/** The whole view is held from before (a reconnect, or one kept on this device): nothing in it has just arrived. */
	held: boolean;
	rooms: RoomSnapshot[];
	you: Identity | undefined;
	/** The room or thread being read, and whether its latest message is on screen. */
	pane: string | undefined;
	latestVisible: boolean;
}

/** What tells new arrivals from history: `MentionTracker` and `IncomingMessageTracker`. */
export interface ArrivalTrackers {
	mentions: { observe(rooms: RoomSnapshot[], me: Identity | undefined, pane: string | undefined, latestVisible: boolean): MessageRecord[] };
	messages: { observe(rooms: RoomSnapshot[], me: Identity | undefined): MessageRecord[] };
}

/** The page's notification settings as they stand. */
export interface AlertSettings {
	/** Notifications could be offered now (`offersNotifications`), and no offer is up yet. */
	offerable: boolean;
	/** Notifications are on and allowed on this device. */
	active: boolean;
	/** Nobody is looking at the page. */
	away: boolean;
	/** Paused, or do not disturb (`pageSilenced`). */
	silenced: boolean;
	/** What to notify about (`notifyScopesOf`). */
	scopes: readonly string[];
}

export interface Alerts {
	/** Mentions of you that arrived outside the rooms you muted. */
	audible: number;
	/** Offer notifications, naming the first of those mentions. */
	offer?: { from: string; room: string };
	/** The desktop notifications to show: one per room, and whether it is for a mention. */
	notify: Array<{ event: MessageRecord; mention: boolean }>;
}

const NOTHING: Alerts = { audible: 0, notify: [] };

/**
 * Observes the arrivals in `view` and says what to alert about. A held view
 * alerts about nothing, and isn't observed: what it shows is from before, so
 * the live rooms that replace it count from where they are. A mention in a
 * room you muted (§4.5), or a thread of one, isn't heard. Desktop
 * notifications go out only while they are on, nobody is looking and the
 * page isn't silenced, for what the checked scopes cover (an edit that adds
 * you counts as a mention), one per room.
 */
export function arrivalAlerts(view: AlertView, trackers: ArrivalTrackers, settings: AlertSettings): Alerts {
	if (view.held) return NOTHING;
	const mentions = trackers.mentions.observe(view.rooms, view.you, view.pane, view.latestVisible);
	const messages = trackers.messages.observe(view.rooms, view.you);
	const heard = mentions.filter((event) => !inMutedRoom(event, view.rooms));
	const first = heard[0];
	const offer = first && settings.offerable
		? { from: senderName(first), room: view.rooms.find((room) => room.id === first.room_id)?.title ?? first.room_id }
		: undefined;
	const alerts: Alerts = { audible: heard.length, ...(offer ? { offer } : {}), notify: [] };
	if (!settings.active || !settings.away || settings.silenced) return alerts;
	const mentioned = new Set(mentions.map((event) => event.message_id));
	const context = { me: view.you, rooms: view.rooms };
	const selected = [...messages, ...mentions]
		.filter((event) => inNotifyScopes(event, settings.scopes, { ...context, mentioned: mentioned.has(event.message_id) }));
	alerts.notify = notificationsByRoom(selected, mentioned).map((event) => ({ event, mention: mentioned.has(event.message_id) }));
	return alerts;
}
