// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { profileCard } from '$lib/ui/profile-card.svelte';
import { blankSnapshot, type SessionView } from '$lib/ui/session.svelte';
import ProfileCard from './ProfileCard.svelte';

let instance: ReturnType<typeof mount> | undefined;

// jsdom has no ResizeObserver, which `bind:offsetHeight` uses.
beforeEach(() => {
	vi.stubGlobal('ResizeObserver', class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	});
});

afterEach(() => {
	profileCard.close();
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	directory.forget();
	vi.unstubAllGlobals();
});

const ada: Identity = { user_id: 'ada', name: 'Ada', status: 'online' };

/** The card for `userId`, signed in as `you`, with these users known. */
function render(userId: string, users: Identity[], you: Identity = ada): HTMLElement {
	const snapshot: ClientSnapshot = { ...blankSnapshot(), authenticated: true, you, users: Object.fromEntries(users.map((user) => [user.user_id, user])), recordedUsers: {}, userAliases: {} };
	directory.apply(snapshot, undefined);
	const session = { snapshot, canManageRooms: false } as unknown as SessionView;
	instance = mount(ProfileCard, { target: document.body, props: { client: undefined, session, room: undefined, canChange: false, canMention: false, onmention: () => undefined } });
	const anchor = document.createElement('button');
	document.body.appendChild(anchor);
	profileCard.toggle({ anchor, userId });
	flushSync();
	return document.querySelector<HTMLElement>('[data-testid="profile-card"]')!;
}

describe('ProfileCard status', () => {
	it('shows an unknown status as unknown, with its literal value (§4.11)', () => {
		const card = render('eve', [ada, { user_id: 'eve', name: 'Eve', status: 'in a meeting' }]);
		expect(card.querySelector('[data-testid="profile-status"]')?.textContent).toBe('Unknown status: in a meeting');
		expect(card.querySelector('[data-testid="profile-status"] code')?.textContent).toBe('in a meeting');
		expect(card.querySelector('.ap-presence-unknown')?.getAttribute('title')).toBe('Unknown status: in a meeting');
	});

	it('says a known status in words, and none without one', () => {
		let card = render('bo', [ada, { user_id: 'bo', name: 'Bo', status: 'dnd' }]);
		expect(card.querySelector('[data-testid="profile-status"]')?.textContent).toBe('Do not disturb');
		profileCard.close();
		unmount(instance!);
		card = render('cy', [ada, { user_id: 'cy', name: 'Cy', status: '' }]);
		expect(card.querySelector('[data-testid="profile-status"]')).toBeNull();
		expect(card.querySelector('.ap-presence')).toBeNull();
	});

	it('shows your own invisible as you chose it', () => {
		const hidden = { ...ada, status: 'invisible' };
		const card = render('ada', [hidden], hidden);
		expect(card.querySelector('[data-testid="profile-status"]')?.textContent).toBe('Invisible · others see you as offline');
		expect(card.querySelector('.ap-presence-invisible')).not.toBeNull();
	});
});
