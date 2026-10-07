// @vitest-environment jsdom
import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Avatar from './Avatar.svelte';
import StatusDot from './StatusDot.svelte';
import { presence, presenceLabel } from './util';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render<P extends Record<string, unknown>>(C: Component<P>, props: P): HTMLElement | null {
	instance = mount(C, { target: document.body, props });
	flushSync();
	return document.querySelector<HTMLElement>('.ap-presence');
}

describe('presence', () => {
	it('keeps the known statuses, takes any other as unknown, and leaves an absent one absent (§4.5)', () => {
		expect(['online', 'idle', 'dnd', 'offline', 'invisible'].map(presence)).toEqual(['online', 'idle', 'dnd', 'offline', 'invisible']);
		expect(presence('away')).toBe('unknown');
		// Empty is no status (§4.5): no dot, as when absent.
		expect(presence('')).toBeUndefined();
		expect(presence('Online')).toBe('unknown');
		expect(presence(undefined)).toBeUndefined();
	});

	it('says an unknown status with its value', () => {
		expect(presenceLabel('dnd')).toBe('Do not disturb');
		expect(presenceLabel('brb')).toBe('Unknown status: brb');
		expect(presenceLabel('')).toBeUndefined();
	});
});

describe('StatusDot', () => {
	it('draws offline as a hollow ring, your invisible as one too, and an unknown status as a placeholder with its value', () => {
		expect(render(StatusDot, { status: 'offline' })?.className).toContain('ap-presence-offline');
		unmount(instance!);
		const invisible = render(StatusDot, { status: 'invisible' })!;
		expect(invisible.className).toContain('ap-presence-invisible');
		expect(invisible.title).toBe('Invisible');
		unmount(instance!);
		const unknown = render(StatusDot, { status: 'invisible-ish' })!;
		expect(unknown.className).toContain('ap-presence-unknown');
		expect(unknown.getAttribute('aria-label')).toBe('Unknown status: invisible-ish');
	});

	it('draws nothing without a status', () => {
		expect(render(StatusDot, {})).toBeNull();
		expect(document.body.textContent).toBe('');
	});

	it('says its status as an image, with the same words as its tooltip', () => {
		const dot = render(StatusDot, { status: 'dnd', size: 'sm' as const })!;
		expect(dot.className).toContain('ap-presence-sm');
		expect(dot.getAttribute('role')).toBe('img');
		expect(dot.getAttribute('aria-label')).toBe('Do not disturb');
		expect(dot.title).toBe('Do not disturb');
	});

	it('takes other words, and keeps only the tooltip when decorative', () => {
		const dot = render(StatusDot, { status: 'invisible', label: 'Invisible · others see you as offline', decorative: true })!;
		expect(dot.title).toBe('Invisible · others see you as offline');
		expect(dot.getAttribute('aria-hidden')).toBe('true');
		expect(dot.hasAttribute('role')).toBe(false);
		expect(dot.hasAttribute('aria-label')).toBe(false);
	});
});

describe('Avatar with a status', () => {
	it('wraps the face with a decorative dot, the ring for offline, carrying its tooltip', () => {
		const dot = render(Avatar, { name: 'Alice Chen', status: 'offline' })!;
		expect(dot.parentElement?.className).toContain('ap-avatar-status');
		expect(dot.className).toContain('ap-presence-offline');
		expect(dot.title).toBe('Offline');
		expect(dot.getAttribute('aria-hidden')).toBe('true');
		unmount(instance!);
		expect(render(Avatar, { name: 'Alice Chen', status: 'invisible', statusLabel: 'Invisible · others see you as offline' })?.title).toBe('Invisible · others see you as offline');
	});

	it('is the bare face without one', () => {
		expect(render(Avatar, { name: 'Alice Chen' })).toBeNull();
		expect(document.querySelector('.ap-avatar-status')).toBeNull();
		expect(document.querySelector('.ap-avatar')?.textContent).toBe('AC');
	});
});
