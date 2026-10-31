// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ProfileBar from './ProfileBar.svelte';
import ProfileEditor from './ProfileEditor.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(ProfileBar, { backend: 'Work', ...props });
	return document.querySelector<HTMLButtonElement>('.ap-profile-me')!;
}

describe('ProfileBar', () => {
	it('names you, your status and what to add in its label, or what it’s waiting for before there is a you', () => {
		const me = render({ you: { user_id: 'alice', name: 'Alice' }, status: 'dnd', note: 'add a sign-in' });
		expect(me.getAttribute('aria-label')).toBe('Open preferences. Your profile on Work: Alice, do not disturb');
		expect(me.querySelector('.ap-profile-sub')?.textContent).toBe('on Work · add a sign-in');
		dom.unmount();
		const waiting = render({ placeholder: 'Signing in…' });
		expect(waiting.getAttribute('aria-label')).toBe('Open preferences. Your profile on Work: signing in');
		expect(waiting.querySelector('.ap-profile-name')?.textContent).toBe('Signing in…');
	});

	it('is one button to your profile and the preferences, its gear marked while notifications are paused', () => {
		const onopen = vi.fn();
		const me = render({ you: { user_id: 'alice' }, onopen, paused: 'until 14:30' });
		expect(document.querySelectorAll('.ap-profile button')).toHaveLength(1);
		expect(me.getAttribute('aria-label')).toBe('Open preferences. Notifications paused until 14:30. Your profile on Work: alice');
		expect(me.querySelector('.ap-profile-gear .ap-profile-paused')).not.toBeNull();
		me.click();
		expect(onopen).toHaveBeenCalledOnce();
	});
});

describe('ProfileEditor', () => {
	it('picks an avatar with its own file input, and says why a handle was declined', () => {
		const onavatarfile = vi.fn();
		dom.render(ProfileEditor, { userId: 'guest_7', name: 'root', canUpload: true, onavatarfile, status: 'declined', declinedNote: 'The server declined this handle (reserved). Sign in and it’s applied.', dialog: false });
		expect(document.querySelector('form')?.getAttribute('role')).toBeNull();
		const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
		const picked = vi.spyOn(input, 'click');
		dom.button('Add avatar').click();
		expect(picked).toHaveBeenCalledOnce();
		const file = new File(['png'], 'face.png', { type: 'image/png' });
		Object.defineProperty(input, 'files', { configurable: true, value: [file] });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		expect(onavatarfile).toHaveBeenCalledExactlyOnceWith(file);
		expect(dom.byRole('alert').textContent).toBe('The server declined this handle (reserved). Sign in and it’s applied.');
	});

	it('counts a bio in characters, and holds Save while it is over maxBio', () => {
		dom.render(ProfileEditor, { userId: 'ada', name: 'Ada', bio: '🦆🦆🦆', maxBio: 3, dialog: false });
		expect(dom.button('Save').disabled).toBe(false);
		expect(document.body.textContent).toContain('3/3');
		const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Bio"]')!;
		field.value = '🦆🦆🦆🦆';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(document.body.textContent).toContain('4/3');
		expect(field.getAttribute('aria-invalid')).toBe('true');
		expect(dom.button('Save').disabled).toBe(true);
	});

	it('offers Connect to a server… in a Server group of its own, enabled while saving, and none without onconnect', () => {
		const onconnect = vi.fn();
		dom.render(ProfileEditor, { userId: 'guest_7', name: 'Ada', onconnect, status: 'saving', dialog: false });
		const group = dom.byRole('group', 'Server');
		const connect = dom.button('Connect to a server…', group);
		expect(connect.disabled).toBe(false);
		connect.click();
		expect(onconnect).toHaveBeenCalledOnce();
		dom.unmount();
		document.body.replaceChildren();
		dom.render(ProfileEditor, { userId: 'guest_7', name: 'Ada', dialog: false });
		expect(dom.queryByRole('group', 'Server')).toBeNull();
	});

	it('has no Bio field without maxBio, and says why the server refused one', () => {
		dom.render(ProfileEditor, { userId: 'ada', name: 'Ada', dialog: false });
		expect(document.querySelector('textarea')).toBeNull();
		dom.unmount();
		dom.render(ProfileEditor, { userId: 'ada', name: 'Ada', maxBio: 250, bioError: 'Your bio is too long for this server. Try a shorter one.', dialog: false });
		expect(dom.byRole('alert').textContent).toBe('Your bio is too long for this server. Try a shorter one.');
	});
});
