// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import SidebarHead from './SidebarHead.svelte';
import * as dom from '$lib/test/dom';
import { media } from '$lib/test/media';

const head = () => document.querySelector<HTMLElement>('.ap-shell-sidehead')!;
const text = (selector: string) => head().querySelector(selector)?.textContent ?? null;

describe('SidebarHead', () => {
	it('shows the server’s avatar and title over its host, the whole address its tooltip, and is no control', () => {
		dom.render(SidebarHead, { name: 'Northwind Ops', address: 'wss://chat.northwind.dev/', avatar: media('data:image/png;base64,AAAA') });
		const avatar = head().querySelector<HTMLImageElement>('img.ap-shell-sidehead-avatar')!;
		expect(avatar.getAttribute('src')).toBe('data:image/png;base64,AAAA');
		expect(avatar.alt).toBe('');
		expect(head().querySelector('.ap-shell-sidehead-initials')).toBeNull();
		expect(text('.ap-shell-sidehead-name')).toBe('Northwind Ops');
		expect(text('.ap-shell-sidehead-host')).toBe('chat.northwind.dev');
		expect(head().querySelector('.ap-shell-sidehead-server')?.getAttribute('title')).toBe('wss://chat.northwind.dev/');
		// The way to another server is the profile's Connect to a server…, not the head.
		expect(head().querySelector('button')).toBeNull();
	});

	it('without a title or avatar: its initials, and its host once, with a port that isn’t the default', () => {
		dom.render(SidebarHead, { name: 'chat.example.org:8443', address: 'wss://chat.example.org:8443/ws' });
		expect(head().querySelector('img')).toBeNull();
		const initials = head().querySelector('.ap-shell-sidehead-initials')!;
		expect(initials.textContent).toBe('C');
		expect(initials.getAttribute('aria-hidden')).toBe('true');
		expect(text('.ap-shell-sidehead-name')).toBe('chat.example.org:8443');
		expect(head().querySelector('.ap-shell-sidehead-host')).toBeNull();
		dom.unmount();
		document.body.replaceChildren();
		// The default port isn't part of the host.
		dom.render(SidebarHead, { name: 'Work', address: 'wss://chat.example.org:443/' });
		expect(text('.ap-shell-sidehead-host')).toBe('chat.example.org');
		expect(text('.ap-shell-sidehead-initials')).toBe('W');
	});

	it('keeps a long title whole in the markup, for the stylesheet to cut short, beside the phone’s › back', () => {
		const onreturn = vi.fn();
		const long = 'Northwind Operations & Site Reliability (EU + US)';
		dom.render(SidebarHead, { name: long, address: 'wss://chat.northwind.dev/', returnTo: 'deploys', onreturn });
		expect(text('.ap-shell-sidehead-name')).toBe(long);
		dom.button('Back to deploys').click();
		expect(onreturn).toHaveBeenCalledOnce();
	});
});
