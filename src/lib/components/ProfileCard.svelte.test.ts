// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot, RoomSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { profileCard } from '$lib/ui/profile-card.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import ProfileCard from './ProfileCard.svelte';
import * as dom from '$lib/test/dom';

// jsdom has no ResizeObserver, which `bind:offsetHeight` uses.
beforeEach(() => {
	dom.stubResizeObserver();
});

afterEach(() => {
	profileCard.close();
	directory.forget();
	vi.unstubAllGlobals();
});

const ada: Identity = { user_id: 'ada', name: 'Ada', status: 'online' };

/** The card for `userId`, signed in as `you`, with these users known. */
function render(userId: string, users: Identity[], you: Identity = ada, room?: RoomSnapshot, member?: boolean): HTMLElement {
	const snapshot: ClientSnapshot = { ...blankSnapshot(), authenticated: true, you, users: Object.fromEntries(users.map((user) => [user.user_id, user])), recordedUsers: {}, userAliases: {} };
	directory.apply(snapshot, undefined);
	const session = { snapshot, canManageRooms: false } as unknown as SessionView;
	dom.render(ProfileCard, { client: undefined, session, room, canChange: false, canMention: false, onmention: () => undefined });
	const anchor = document.createElement('button');
	document.body.appendChild(anchor);
	profileCard.toggle({ anchor, userId, ...(member !== undefined ? { member } : {}) });
	flushSync();
	return document.querySelector<HTMLElement>('[data-testid="profile-card"]')!;
}

describe('ProfileCard status', () => {
	it('shows your own invisible as you chose it', () => {
		const hidden = { ...ada, status: 'invisible' };
		const card = render('ada', [hidden], hidden);
		expect(card.querySelector('[data-testid="profile-status"]')?.textContent).toBe('Invisible · others see you as offline');
		expect(card.querySelector('.ap-presence-invisible')).not.toBeNull();
	});
});

describe('ProfileCard membership', () => {
	const bob: Identity = { user_id: 'bob', name: 'Bob' };
	// A large room that lists only its recently active members, without Bob.
	const general = { id: 'general', title: 'General', joined: true, members: [ada], memberCount: 40 } as unknown as RoomSnapshot;

	it('says a member the listing leaves out may still be one', () => {
		expect(render('bob', [ada, bob], ada, general).textContent).toContain('Not among the recently active members of General');
	});

	it('says they are a member when a lookup found them (a link’s user, §4.2.1)', () => {
		expect(render('bob', [ada, bob], ada, general, true).textContent).toContain('Member of General');
	});
});
