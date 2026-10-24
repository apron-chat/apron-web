import type { RoomSnapshot } from '$lib/protocol/client';
import { notificationGroup } from './notifications';

/**
 * Reading the open pane's latest message: it advances your read position and
 * your read cursor (capability `activity`), which the server syncs to your
 * other devices, and closes that pane's notifications on this device.
 */

/** The open pane as the page reads it. */
export interface ReadState {
	/** The server the page is connected to (`client.url`); undefined before there is a client. */
	server: string | undefined;
	/** The room or thread in the pane. */
	room: Pick<RoomSnapshot, 'id' | 'loaded'> | undefined;
	/** Its latest message's `message_id`. */
	last: string | undefined;
	/** The session is live (`SessionView.ready`): its rooms are listed on this connection, not held from before. */
	ready: boolean;
	/** The latest message is on screen in this pane, and the pane has opened at its New divider. */
	readingLatest: boolean;
	/** The page is in view. */
	visible: boolean;
	/** Nobody is looking at it (in view but not focused, say). */
	away: boolean;
}

/** What `readAction` needs to close notifications: the account's `push_id`, and the last read whose were closed. */
export interface ReadNotifications {
	pushId: string | undefined;
	closedThrough: string | undefined;
}

export interface ReadAction {
	/** Mark `message` read in `room`: the read position and the read cursor. */
	room: string;
	message: string;
	/**
	 * Close the room's notifications on this device up to `message`: those of the account's group where it has
	 * a `push_id`, else the page's own of the room. `key` names this read, kept so each closes once.
	 */
	close?: { key: string; target: { group: string } | { tag: string } };
}

/**
 * What reading the pane does now, if anything. Only from a live session, in
 * view, in a loaded pane, at its latest message once the pane has opened at
 * its divider: a held or primed view is from before, and marking first would
 * hide what was new. Notifications close only once you're looking (focused
 * too): an unfocused window shows its own desktop notification of what
 * arrives, which must stay until you come back.
 */
export function readAction(state: ReadState, notifications: ReadNotifications): ReadAction | undefined {
	const { server, room, last } = state;
	if (server === undefined || !room || last === undefined || !state.readingLatest || !state.visible || !room.loaded || !state.ready) return undefined;
	const action: ReadAction = { room: room.id, message: last };
	if (state.away) return action;
	const key = `${notifications.pushId ?? ''}:${server}:${room.id}:${last}`;
	if (key === notifications.closedThrough) return action;
	const target = notifications.pushId ? { group: notificationGroup(notifications.pushId, room.id) } : { tag: `apron:${server}:${room.id}` };
	return { ...action, close: { key, target } };
}
