// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import InstallPrompt from './InstallPrompt.svelte';
import type { InstallWay } from '$lib/ui/install';
import * as dom from '$lib/test/dom';

function render(way: InstallWay, props: Partial<{ alerts: boolean; oninstall: () => void; ondecline: () => void }> = {}) {
	dom.render(InstallPrompt, { way, oninstall: () => {}, ondecline: () => {}, ...props });
	return document.querySelector<HTMLElement>('[data-testid="install-prompt"]')!;
}

const button = (name: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === name);

describe('InstallPrompt', () => {
	it('asks the browser to install, where it offers to, or declines', () => {
		const oninstall = vi.fn();
		const ondecline = vi.fn();
		const prompt = render('prompt', { oninstall, ondecline });
		expect(prompt.getAttribute('role')).toBe('dialog');
		expect(document.getElementById(prompt.getAttribute('aria-labelledby')!)?.textContent).toBe('Add Apron to your Home Screen?');
		expect(document.getElementById(prompt.getAttribute('aria-describedby')!)?.textContent).toBe('It opens full screen, like an app.');
		button('Install')!.click();
		expect(oninstall).toHaveBeenCalledOnce();
		button('Not now')!.click();
		expect(ondecline).toHaveBeenCalledOnce();
		expect(button('Show me how')).toBeUndefined();
	});

	it('shows the steps for this browser on Show me how, then Got it answers it', () => {
		const ondecline = vi.fn();
		const prompt = render('ios-safari', { alerts: true, ondecline });
		expect(prompt.textContent).toContain('like an app, and can alert you when it’s closed.');
		expect(prompt.querySelector('[data-testid="install-steps"]')).toBeNull();
		const shown = button('Show me how')!;
		shown.click();
		flushSync();
		const steps = [...prompt.querySelectorAll('[data-testid="install-steps"] li')].map((step) => step.textContent);
		expect(steps).toEqual(['Tap Share, in the toolbar or Safari’s  menu', 'Choose Add to Home Screen (under View More, if it isn’t listed)', 'Tap Add']);
		expect(prompt.querySelector('[aria-label="More"]')?.getAttribute('role')).toBe('img');
		expect(prompt.textContent).toContain('Not there? Open this page in Safari first.');
		expect(button('Not now')).toBeUndefined();
		// The same button, so focus stays on it.
		expect(button('Got it')).toBe(shown);
		button('Got it')!.click();
		expect(ondecline).toHaveBeenCalledOnce();
	});

	it('sends an app’s own browser to the browser first, and Escape declines', () => {
		const ondecline = vi.fn();
		const prompt = render('in-app', { ondecline });
		expect(prompt.textContent).toContain('This app’s browser can’t, so open Apron in your browser first.');
		button('Show me how')!.click();
		flushSync();
		expect(prompt.textContent).toContain('choose to open the page in your browser');
		prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(ondecline).toHaveBeenCalledOnce();
	});
});

describe('InstallPrompt, once the browser offers to install', () => {
	it('drops the steps shown before for its Install', () => {
		const props = $state<{ way: InstallWay; oninstall: () => void; ondecline: () => void }>({ way: 'android', oninstall: () => {}, ondecline: () => {} });
		dom.render(InstallPrompt, props);
		button('Show me how')!.click();
		flushSync();
		expect(document.querySelector('[data-testid="install-steps"]')).not.toBeNull();
		props.way = 'prompt';
		flushSync();
		expect(document.querySelector('[data-testid="install-steps"]')).toBeNull();
		expect(button('Install')).toBeDefined();
		expect(button('Not now')).toBeDefined();
	});
});
