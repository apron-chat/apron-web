import { describe, expect, it } from 'vitest';
import { inLobby, inviteCommand, lobbyBanner, lobbyMarker, PUBLIC_WHEN_OPEN, VISIBLE_TO_EVERYONE } from './lobby';

describe('the lobby’s marker', () => {
	const open = { room_id: 'lobby', open: true };
	it('marks the lobby as visible to everyone while open, and public when open again while closed', () => {
		expect(lobbyMarker(open, 'lobby', false)).toBe(VISIBLE_TO_EVERYONE);
		expect(lobbyMarker({ ...open, open: false }, 'lobby', false)).toBe(PUBLIC_WHEN_OPEN);
	});

	it('marks no other room, nothing without a lobby, and nothing for someone limited to it', () => {
		expect(lobbyMarker(open, 'general', false)).toBeUndefined();
		expect(lobbyMarker(undefined, 'lobby', false)).toBeUndefined();
		expect(lobbyMarker(open, undefined, false)).toBeUndefined();
		expect(lobbyMarker(open, 'lobby', true)).toBeUndefined();
	});
});

describe('who is offered Invite', () => {
	it('is someone with a waiting or invited role, or a guest', () => {
		expect(inLobby({ user_id: 'wanda', roles: ['waiting'] })).toBe(true);
		expect(inLobby({ user_id: 'guest_7', roles: ['invited'] })).toBe(true);
		expect(inLobby({ user_id: 'guest_7' })).toBe(true);
		expect(inLobby({ user_id: 'zed', roles: ['guest'] })).toBe(true);
	});

	it('is no member, and no one unknown', () => {
		expect(inLobby({ user_id: 'ada', roles: ['admin'] })).toBe(false);
		expect(inLobby({ user_id: 'bob' })).toBe(false);
		expect(inLobby(undefined)).toBe(false);
	});

	it('sends /invite with the user_id', () => {
		expect(inviteCommand('guest_7')).toBe('/invite guest_7');
	});
});

describe('the lobby’s banner', () => {
	const room = 'Public Lobby';
	it('tells a waiting guest where they are, and offers a passkey to keep their place', () => {
		expect(lobbyBanner('waiting', { guest: true, room, passkey: true, signUp: true })).toEqual({
			title: 'You’re in the Public Lobby.',
			detail: 'Introduce yourself; an admin or moderator can invite you in. Add a passkey to keep your place.',
			action: { kind: 'passkey', label: 'Add a passkey' },
			invited: false
		});
		// Without passkeys here, another way the server signs up with; with none, nothing to offer.
		expect(lobbyBanner('waiting', { guest: true, room, passkey: false, signUp: true }).action).toEqual({ kind: 'signup', label: 'Create account' });
		expect(lobbyBanner('waiting', { guest: true, room, passkey: false, signUp: false })).toEqual({
			title: 'You’re in the Public Lobby.', detail: 'Introduce yourself; an admin or moderator can invite you in.', invited: false
		});
	});

	it('tells a waiting account the same, without the passkey', () => {
		expect(lobbyBanner('waiting', { guest: false, room, passkey: true, signUp: true })).toEqual({
			title: 'You’re in the Public Lobby.', detail: 'Introduce yourself; an admin or moderator can invite you in.', invited: false
		});
	});

	it('names the room as titled, without a second "the"', () => {
		expect(lobbyBanner('waiting', { guest: false, room: 'The Front Door', passkey: false, signUp: false }).title).toBe('You’re in The Front Door.');
		expect(lobbyBanner('waiting', { guest: false, room: 'intros', passkey: false, signUp: false }).title).toBe('You’re in the intros.');
	});

	it('asks an invited guest, prominently, to create a passkey to finish joining', () => {
		expect(lobbyBanner('invited', { guest: true, room, passkey: true, signUp: true })).toEqual({
			title: 'You’ve been invited.',
			detail: 'Create a passkey to finish joining. Until you do, closing this page ends your visit.',
			action: { kind: 'passkey', label: 'Create passkey' },
			invited: true
		});
		expect(lobbyBanner('invited', { guest: true, room, passkey: false, signUp: true }).action).toEqual({ kind: 'signup', label: 'Create account' });
		expect(lobbyBanner('invited', { guest: true, room, passkey: false, signUp: false }).action).toBeUndefined();
	});
});
