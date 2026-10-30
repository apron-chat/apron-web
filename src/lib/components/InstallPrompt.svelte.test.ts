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
		button('Show me how')!.click();
		flushSync();
		const steps = [...prompt.querySelectorAll('[data-testid="install-steps"] li')].map((step) => step.textContent);
		expect(steps).toEqual(['Tap Share (in Safari’s  menu, if it isn’t in the toolbar)', 'Choose Add to Home Screen', 'Tap Add']);
		expect(button('Not now')).toBeUndefined();
		button('Got it')!.click();
		expect(ondecline).toHaveBeenCalledOnce();
	});

	it('sends an app’s own browser to the browser first, and Escape declines', () => {
		const ondecline = vi.fn();
		const prompt = render('in-app', { ondecline });
		expect(prompt.textContent).toContain('This app’s browser can’t, so open Apron in your browser first.');
		button('Show me how')!.click();
		flushSync();
		expect(prompt.textContent).toContain('Open in browser');
		prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(ondecline).toHaveBeenCalledOnce();
	});
});
