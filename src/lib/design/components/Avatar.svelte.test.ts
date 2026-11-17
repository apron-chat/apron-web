// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar.svelte';
import * as dom from '$lib/test/dom';
import { byText } from '$lib/test/queries';
import { media } from '$lib/test/media';

describe('Avatar', () => {
	it('tints initials by their hue, which apron.css reads from --avatar-hue', () => {
		dom.render(Avatar, { name: 'Ada Lovelace', hue: 210 });
		const face = byText('AL');
		// The tint is the class and the custom property: the interface apron.css draws it with.
		expect(face.classList.contains('ap-avatar-hued')).toBe(true);
		expect(face.style.getPropertyValue('--avatar-hue')).toBe('210');
		expect(face.getAttribute('aria-hidden')).toBe('true');
	});

	it('keeps the placeholder without a hue, and shows an image where there is one', () => {
		dom.render(Avatar, { name: 'Bob' });
		expect(byText('B').classList.contains('ap-avatar-hued')).toBe(false);
		expect(byText('B').style.getPropertyValue('--avatar-hue')).toBe('');
		dom.unmount();
		document.body.innerHTML = '';
		dom.render(Avatar, { name: 'Bob', hue: 30, src: media('https://chat.example/bob.png') });
		const image = document.querySelector('img')!;
		expect([image.getAttribute('src'), image.alt]).toEqual(['https://chat.example/bob.png', '']);
		expect(document.body.textContent).toBe('');
	});

	it('draws xs, for a face inside a line of small text, without a status, which it is too small to carry', () => {
		dom.render(Avatar, { name: 'Ada Lovelace', size: 'xs', status: 'online' });
		expect(byText('AL').classList.contains('ap-avatar-xs')).toBe(true);
		expect(document.querySelector('.ap-presence')).toBeNull();
	});

	it('marks a remote user with a globe in place of their status, which isn’t shared between servers, saying where from', () => {
		dom.render(Avatar, { name: 'Sam', size: 'sm', status: 'offline', remote: 'a.example' });
		const badge = document.querySelector('.ap-remote-badge')!;
		expect([badge.getAttribute('role'), badge.getAttribute('aria-label'), badge.getAttribute('title')]).toEqual(['img', 'From a.example', 'From a.example']);
		expect(badge.querySelector('svg')).not.toBeNull();
		expect(document.querySelector('.ap-presence')).toBeNull();
		dom.unmount();
		document.body.innerHTML = '';
		// Too small for either.
		dom.render(Avatar, { name: 'Sam', size: 'xs', remote: 'a.example' });
		expect(document.querySelector('.ap-remote-badge')).toBeNull();
	});
});
