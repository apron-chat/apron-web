// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import SignInForm from './SignInForm.svelte';
import * as dom from '$lib/test/dom';
import { byLabel, byText } from '$lib/test/queries';

function render(props: Record<string, unknown>) {
	dom.render(SignInForm, { schemes: ['guest', 'webauthn', 'email', 'external', 'token'], scheme: 'guest', submit: 'Connect', ...props });
	return document.querySelector('form')!;
}

/** The fields the form shows, by their labels, and the Passkey choices if it offers them. */
const fields = () => [
	...[...document.querySelectorAll<HTMLLabelElement>('form label')].map((label) => label.firstChild?.textContent?.trim()),
	...[...document.querySelectorAll('[role="radiogroup"][aria-label="Passkey"] [role="radio"]')].map((choice) => choice.querySelector('.ap-choice-title')?.textContent)
];

describe('SignInForm', () => {
	it('labels the schemes it knows, and an unknown one by its name, and shows the fields each takes, the display name only where asked', () => {
		render({ schemes: ['webauthn', 'external', 'ext:sso'], scheme: 'external' });
		const tabs = [...document.querySelectorAll('[role="radio"]')];
		expect(tabs.map((tab) => tab.textContent)).toEqual(['Passkey', 'External', 'ext:sso']);
		expect(tabs.map((tab) => tab.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
		dom.unmount();
		// Each shows the fields it takes, and the display name only where asked.
		render({ scheme: 'token', askName: false });
		expect(fields()).toEqual(['Token']);
		dom.unmount();
		render({ scheme: 'token', askName: true });
		expect(fields()).toEqual(['Token', 'Your name, if this is an invite']);
		dom.unmount();
		render({ scheme: 'email' });
		expect(fields()).toEqual(['Email', 'Display name']);
		dom.unmount();
		render({ scheme: 'webauthn', passkeyChoice: true, askName: false });
		expect(fields()).toEqual(['Sign in', 'Create account']);
	});

	it('says where a code went: an email keeps its address, an external page is linked, each with a way to start again', () => {
		const onrestart = vi.fn();
		render({ scheme: 'email', email: 'ada@example.com', sent: { scheme: 'email', email: 'ada@example.com' }, onrestart });
		expect([byLabel('Email').value, byLabel('Email').disabled]).toEqual(['ada@example.com', true]);
		expect(byLabel('Code').inputMode).toBe('numeric');
		expect(dom.byRole('status').textContent).toContain('If ada@example.com can sign in here');
		dom.button('Use another address, or send a new code').click();
		expect(onrestart).toHaveBeenCalledOnce();
		dom.unmount();
		render({ scheme: 'external', sent: { scheme: 'external', page: 'https://sso.example/' }, onrestart });
		expect(dom.byRole('link', 'Open the sign-in page').getAttribute('href')).toBe('https://sso.example/');
		expect(byLabel('Code').placeholder).toBe('From the sign-in page');
		dom.button('Start again').click();
		expect(onrestart).toHaveBeenCalledTimes(2);
	});

	it('says the hint as a status only when asked, and waits while busy', () => {
		const form = render({ hint: 'No token needed.', busy: true, secondary: { label: 'Cancel', onclick: () => {} } });
		expect(byText('No token needed.').hasAttribute('role')).toBe(false);
		expect(form.querySelector('.ap-typing-dots')).not.toBeNull();
		const submit = dom.button('Connect');
		expect([submit.type, submit.disabled]).toEqual(['submit', true]);
		expect(dom.button('Cancel').disabled).toBe(false);
	});
});
