// @vitest-environment jsdom
import { flushSync, mount, unmount, type Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Avatar from './Avatar.svelte';
import StatusDot from './StatusDot.svelte';
import { presence } from './util';

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
	it('keeps the four statuses, counts an unknown one as offline, and leaves an absent one absent (§4.11)', () => {
		expect(['online', 'idle', 'dnd', 'offline'].map(presence)).toEqual(['online', 'idle', 'dnd', 'offline']);
		expect(presence('away')).toBe('offline');
		expect(presence('')).toBe('offline');
		expect(presence(undefined)).toBeUndefined();
	});
});

describe('StatusDot', () => {
	it('draws offline, and an unknown status, as a hollow ring', () => {
		expect(render(StatusDot, { status: 'offline' })?.className).toContain('ap-presence-offline');
		unmount(instance!);
		expect(render(StatusDot, { status: 'invisible-ish' })?.className).toContain('ap-presence-offline');
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
		const dot = render(StatusDot, { status: 'dnd', label: 'Do not disturb · until 14:30', decorative: true })!;
		expect(dot.title).toBe('Do not disturb · until 14:30');
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
		expect(render(Avatar, { name: 'Alice Chen', status: 'dnd', statusLabel: 'Do not disturb · until you resume' })?.title).toBe('Do not disturb · until you resume');
	});

	it('is the bare face without one', () => {
		expect(render(Avatar, { name: 'Alice Chen' })).toBeNull();
		expect(document.querySelector('.ap-avatar-status')).toBeNull();
		expect(document.querySelector('.ap-avatar')?.textContent).toBe('AC');
	});
});
