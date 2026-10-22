// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignInForm from './SignInForm.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
	instance = mount(SignInForm, { target: document.body, props: { schemes: ['guest', 'webauthn', 'email', 'external', 'token'], scheme: 'guest', submit: 'Connect', ...props } });
	flushSync();
	return document.querySelector('form')!;
}

const testids = () => [...document.querySelectorAll('[data-testid]')].map((element) => element.getAttribute('data-testid'));

describe('SignInForm', () => {
	it('labels the schemes it knows, and an unknown one by its name', () => {
		render({ schemes: ['webauthn', 'external', 'ext:sso'], scheme: 'external' });
		const tabs = [...document.querySelectorAll('[role="radio"]')];
		expect(tabs.map((tab) => tab.textContent)).toEqual(['Passkey', 'External', 'ext:sso']);
		expect(tabs.map((tab) => tab.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
	});

	it('shows the fields the scheme takes, and the display name only where asked', () => {
		render({ scheme: 'token', askName: false });
		expect(testids()).toEqual(['connect-token-input']);
		unmount(instance!);
		render({ scheme: 'token', askName: true });
		expect(testids()).toEqual(['connect-token-input', 'connect-name-input']);
		unmount(instance!);
		render({ scheme: 'email' });
		expect(testids()).toEqual(['connect-email-input', 'connect-name-input']);
		unmount(instance!);
		instance = undefined;
		render({ scheme: 'webauthn', passkeyChoice: true, askName: false });
		expect(testids()).toEqual(['passkey-choice', 'passkey-choice-login', 'passkey-choice-register']);
	});

	it('says where a code went: an email keeps its address, an external page is linked, each with a way to start again', () => {
		const onrestart = vi.fn();
		render({ scheme: 'email', email: 'ada@example.com', sent: { scheme: 'email', email: 'ada@example.com' }, onrestart });
		expect(document.querySelector<HTMLInputElement>('[data-testid="connect-email-input"]')!.disabled).toBe(true);
		expect(document.querySelector<HTMLInputElement>('[data-testid="connect-code-input"]')!.inputMode).toBe('numeric');
		expect(document.querySelector('[role="status"]')!.textContent).toContain('If ada@example.com can sign in here');
		document.querySelector<HTMLButtonElement>('.ap-connect-other')!.click();
		expect(onrestart).toHaveBeenCalledOnce();
		unmount(instance!);
		render({ scheme: 'external', sent: { scheme: 'external', page: 'https://sso.example/' } });
		expect(document.querySelector('[data-testid="external-page-link"]')!.getAttribute('href')).toBe('https://sso.example/');
		expect(document.querySelector<HTMLInputElement>('[data-testid="connect-code-input"]')!.placeholder).toBe('From the sign-in page');
		expect(document.querySelector('.ap-connect-other')!.textContent).toBe('Start again');
	});

	it('says the hint as a status only when asked, and waits while busy', () => {
		const form = render({ hint: 'No token needed.', busy: true, submitTestid: 'connect', secondary: { label: 'Cancel', onclick: () => {} } });
		expect(form.querySelector('.ap-profedit-hint')!.hasAttribute('role')).toBe(false);
		expect(form.querySelector('.ap-typing-dots')).not.toBeNull();
		const submit = form.querySelector<HTMLButtonElement>('[data-testid="connect"]')!;
		expect([submit.type, submit.disabled, submit.textContent]).toEqual(['submit', true, 'Connect']);
		const cancel = [...form.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Cancel')!;
		expect(cancel.disabled).toBe(false);
	});
});
