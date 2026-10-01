import { afterEach, describe, expect, it, vi } from 'vitest';
import { openProfileFrom, profileCard } from './profile-card.svelte';

/** Just enough of an element: what `closest('button[data-user-id]')` finds from it, and focus. */
function element(button?: HTMLElement): HTMLElement {
	return { closest: (selector: string) => (selector === 'button[data-user-id]' ? (button ?? null) : null) } as unknown as HTMLElement;
}

function userButton(userId: string): HTMLElement {
	const button = { dataset: { userId }, isConnected: true, focus: vi.fn() } as unknown as HTMLElement & { closest: unknown };
	button.closest = () => button;
	return button;
}

describe('profile card', () => {
	afterEach(() => profileCard.close());

	it('opens for a user button, from inside it too, and a second press closes it', () => {
		const chip = userButton('ada');
		expect(openProfileFrom(element(chip))).toBe(true);
		expect(profileCard.current).toEqual({ anchor: chip, userId: 'ada' });
		expect(openProfileFrom(chip)).toBe(true);
		expect(profileCard.current).toBeUndefined();
	});

	it('leaves other clicks alone', () => {
		expect(openProfileFrom(element())).toBe(false);
		expect(openProfileFrom(null)).toBe(false);
		expect(profileCard.current).toBeUndefined();
	});

	it('switches to another user, and Escape puts focus back on what opened it', () => {
		const ada = userButton('ada');
		const bo = userButton('bo');
		openProfileFrom(ada);
		openProfileFrom(bo);
		expect(profileCard.current?.userId).toBe('bo');
		profileCard.close(true);
		expect(bo.focus).toHaveBeenCalled();
		expect(ada.focus).not.toHaveBeenCalled();
	});
});
