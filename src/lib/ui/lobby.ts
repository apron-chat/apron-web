import type { Identity, LobbyLimit, LobbySetting } from '$lib/protocol/types';
import { isGuest } from './members';

/**
 * A server's lobby (`ext.settings.lobby`, `ext.permissions.lobby` and `invite`): the one room people the server hasn't
 * admitted may see, how it's marked to those who see more, what the people limited to it are told, and who is offered
 * Invite. Roles grant nothing here: the server decides, from its own `/invite`.
 */

/** What marks the lobby to someone who sees more than it: its records are public, or will be when it opens again. */
export const VISIBLE_TO_EVERYONE = 'Visible to everyone';
export const PUBLIC_WHEN_OPEN = 'Public when the lobby is open';

/**
 * The marker beside the lobby's name, in the rooms list and its header: for `roomId` when it is the server's lobby,
 * and only to someone not limited to it (`limited`), whom the lobby's banner tells where they are instead.
 */
export function lobbyMarker(lobby: LobbySetting | undefined, roomId: string | undefined, limited: boolean): string | undefined {
	if (!lobby || limited || roomId === undefined || lobby.room_id !== roomId) return undefined;
	return lobby.open ? VISIBLE_TO_EVERYONE : PUBLIC_WHEN_OPEN;
}

/** The display roles a server gives people limited to its lobby (§3.3): for display only, as every role. */
const LOBBY_ROLES = ['waiting', 'invited'];

/**
 * Whether `user` looks limited to the lobby, to offer Invite for them: a display role `waiting` or `invited`, or a guest
 * (`isGuest`), whom a lobby server limits to it. A guess, as roles are only labels: the server answers an Invite of a
 * member that they are one already, and changes nothing.
 */
export function inLobby(user: Identity | undefined): boolean {
	if (!user) return false;
	return isGuest(user) || (Array.isArray(user.roles) && user.roles.some((role) => LOBBY_ROLES.includes(role)));
}

/** The command that admits a user from the lobby (`ext:permissions` `invite`), as Invite sends it. */
export function inviteCommand(userId: string): string {
	return `/invite ${userId}`;
}

/** What the lobby's banner says to someone limited to it, and the one thing it offers, if any. */
export interface LobbyBannerText {
	title: string;
	detail: string;
	/** Into the sign-up flow: `passkey` creates an account with a passkey on this connection; `signup` opens signing up. */
	action?: { kind: 'passkey' | 'signup'; label: string };
	/** An invited guest's, which asks for one thing to finish joining. */
	invited: boolean;
}

/** "the Public Lobby", "The Lobby": a room's title as a place to be in. */
function inRoom(title: string): string {
	return /^the\s/i.test(title) ? title : `the ${title}`;
}

/**
 * The lobby's banner for someone limited to it (`limit`), in `room` (the lobby's title). A guest (`guest`, not signed
 * in to an account) is offered to keep their place, or as an invited guest to finish joining, by creating an account
 * on this connection: with a passkey where this browser can make one for the server and it signs up with one
 * (`passkey`), else by another way the server signs up with (`signUp`), else nothing.
 */
export function lobbyBanner(limit: LobbyLimit, options: { guest: boolean; room: string; passkey: boolean; signUp: boolean }): LobbyBannerText {
	const { guest, room, passkey, signUp } = options;
	if (limit === 'invited') {
		// Only a guest is invited (an account waiting is let in at once): nothing to offer otherwise.
		if (!guest) return { title: 'You’ve been invited.', detail: 'The rest of the server shows here once you’re let in.', invited: true };
		const way = passkey ? 'Create a passkey' : 'Create an account';
		return {
			title: 'You’ve been invited.',
			detail: passkey || signUp ? `${way} to finish joining. Until you do, closing this page ends your visit.` : 'Closing this page ends your visit.',
			...(passkey ? { action: { kind: 'passkey' as const, label: 'Create passkey' } } : signUp ? { action: { kind: 'signup' as const, label: 'Create account' } } : {}),
			invited: true
		};
	}
	const intro = 'Introduce yourself; an admin or moderator can invite you in.';
	if (!guest || !(passkey || signUp)) return { title: `You’re in ${inRoom(room)}.`, detail: intro, invited: false };
	return {
		title: `You’re in ${inRoom(room)}.`,
		detail: `${intro} ${passkey ? 'Add a passkey' : 'Create an account'} to keep your place.`,
		action: passkey ? { kind: 'passkey', label: 'Add a passkey' } : { kind: 'signup', label: 'Create account' },
		invited: false
	};
}
