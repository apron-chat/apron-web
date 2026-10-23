// @vitest-environment jsdom
import type { Component } from 'svelte';
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar.svelte';
import StatusDot from './StatusDot.svelte';
import { presence, presenceLabel } from './util';
import * as dom from '$lib/test/dom';

function render<P extends Record<string, unknown>>(C: Component<P>, props: P): HTMLElement | null {
	dom.render(C, props);
	return document.querySelector<HTMLElement>('.ap-presence');
}

describe('presence', () => {
	it('keeps the known statuses, takes any other as unknown, said with its value, and leaves an absent one absent (§4.5)', () => {
		expect(['online', 'idle', 'dnd', 'offline', 'invisible'].map(presence)).toEqual(['online', 'idle', 'dnd', 'offline', 'invisible']);
		expect(presence('away')).toBe('unknown');
		// Empty is no status (§4.5): no dot, as when absent.
		expect(presence('')).toBeUndefined();
		expect(presence('Online')).toBe('unknown');
		expect(presence(undefined)).toBeUndefined();
		// An unknown one is said with its value.
		expect(presenceLabel('dnd')).toBe('Do not disturb');
		expect(presenceLabel('brb')).toBe('Unknown status: brb');
		expect(presenceLabel('')).toBeUndefined();
	});
});

describe('StatusDot', () => {
	it('draws offline as a hollow ring, your invisible as one too, an unknown status as a placeholder with its value, and nothing without one', () => {
		expect(render(StatusDot, { status: 'offline' })?.className).toContain('ap-presence-offline');
		dom.unmount();
		const invisible = render(StatusDot, { status: 'invisible' })!;
		expect(invisible.className).toContain('ap-presence-invisible');
		expect(invisible.title).toBe('Invisible');
		dom.unmount();
		const unknown = render(StatusDot, { status: 'invisible-ish' })!;
		expect(unknown.className).toContain('ap-presence-unknown');
		expect(unknown.getAttribute('aria-label')).toBe('Unknown status: invisible-ish');
		dom.unmount();
		// Nothing without a status.
		expect(render(StatusDot, {})).toBeNull();
		expect(document.body.textContent).toBe('');
	});

	it('says its status as an image, with the same words as its tooltip, or other words, and only the tooltip when decorative', () => {
		const dot = render(StatusDot, { status: 'dnd', size: 'sm' as const })!;
		expect(dot.className).toContain('ap-presence-sm');
		expect(dot.getAttribute('role')).toBe('img');
		expect(dot.getAttribute('aria-label')).toBe('Do not disturb');
		expect(dot.title).toBe('Do not disturb');
		dom.unmount();
		// Other words, and only the tooltip when decorative.
		const decorative = render(StatusDot, { status: 'invisible', label: 'Invisible · others see you as offline', decorative: true })!;
		expect(decorative.title).toBe('Invisible · others see you as offline');
		expect(decorative.getAttribute('aria-hidden')).toBe('true');
		expect(decorative.hasAttribute('role')).toBe(false);
		expect(decorative.hasAttribute('aria-label')).toBe(false);
	});
});

describe('Avatar with a status', () => {
	it('wraps the face with a decorative dot, the ring for offline, carrying its tooltip, and is the bare face without one', () => {
		const dot = render(Avatar, { name: 'Alice Chen', status: 'offline' })!;
		expect(dot.parentElement?.className).toContain('ap-avatar-status');
		expect(dot.className).toContain('ap-presence-offline');
		expect(dot.title).toBe('Offline');
		expect(dot.getAttribute('aria-hidden')).toBe('true');
		dom.unmount();
		expect(render(Avatar, { name: 'Alice Chen', status: 'invisible', statusLabel: 'Invisible · others see you as offline' })?.title).toBe('Invisible · others see you as offline');
		dom.unmount();
		// Without one, the bare face.
		expect(render(Avatar, { name: 'Alice Chen' })).toBeNull();
		expect(document.querySelector('.ap-avatar-status')).toBeNull();
		expect(document.querySelector('.ap-avatar')?.textContent).toBe('AC');
	});
});
