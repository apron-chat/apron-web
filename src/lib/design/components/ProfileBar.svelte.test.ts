// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProfileBar from './ProfileBar.svelte';
import ProfileEditor from './ProfileEditor.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(ProfileBar, { target: document.body, props: { backend: 'Work', ...props } });
	flushSync();
	return document.querySelector<HTMLButtonElement>('.ap-profile-me')!;
}

describe('ProfileBar', () => {
	it('names you, your status and what to add in its label, or what it’s waiting for before there is a you', () => {
		const me = render({ you: { user_id: 'alice', name: 'Alice' }, status: 'dnd', note: 'add a sign-in' });
		expect(me.getAttribute('aria-label')).toBe('Your profile on Work: Alice, do not disturb. Edit');
		expect(me.querySelector('.ap-profile-sub')?.textContent).toMatch(/^on Work ?· add a sign-in$/);
		unmount(instance!);
		const waiting = render({ placeholder: 'Signing in…' });
		expect(waiting.getAttribute('aria-label')).toBe('Your profile on Work: signing in. Edit');
		expect(waiting.querySelector('.ap-profile-name')?.textContent).toBe('Signing in…');
	});

	it('offers the preferences on a gear, marked while notifications are paused', () => {
		const onpreferences = vi.fn();
		render({ you: { user_id: 'alice' }, onpreferences, paused: 'until 14:30' });
		const gear = document.querySelector<HTMLButtonElement>('.ap-profile-settings')!;
		expect(gear.getAttribute('aria-label')).toBe('Open preferences. Notifications paused until 14:30');
		expect(gear.querySelector('.ap-profile-paused')).not.toBeNull();
		gear.click();
		expect(onpreferences).toHaveBeenCalledOnce();
	});
});

describe('ProfileEditor', () => {
	it('picks an avatar with its own file input, and says why a handle was declined', () => {
		const onavatarfile = vi.fn();
		instance = mount(ProfileEditor, { target: document.body, props: { userId: 'guest_7', name: 'root', canUpload: true, onavatarfile, status: 'declined', declinedReason: 'reserved', declinedHint: 'Sign in and it’s applied.', dialog: false } });
		flushSync();
		expect(document.querySelector('form')?.getAttribute('role')).toBeNull();
		const input = document.querySelector<HTMLInputElement>('[data-testid="avatar-input"]')!;
		const picked = vi.spyOn(input, 'click');
		document.querySelector<HTMLButtonElement>('[data-testid="change-avatar"]')!.click();
		expect(picked).toHaveBeenCalledOnce();
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onavatarfile).toHaveBeenCalledWith(input);
		expect(document.querySelector('.ap-profedit-err')?.textContent).toBe('The server declined this handle (reserved). Sign in and it’s applied.');
	});
});
