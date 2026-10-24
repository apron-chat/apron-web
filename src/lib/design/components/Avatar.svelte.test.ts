// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Avatar from './Avatar.svelte';
import * as dom from '$lib/test/dom';
import { byText } from '$lib/test/queries';

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
		dom.render(Avatar, { name: 'Bob', hue: 30, src: 'https://chat.example/bob.png' });
		const image = document.querySelector('img')!;
		expect([image.getAttribute('src'), image.alt]).toEqual(['https://chat.example/bob.png', '']);
		expect(document.body.textContent).toBe('');
	});
});
