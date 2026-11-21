// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import CommandCard from './CommandCard.svelte';
import * as dom from '$lib/test/dom';

describe('CommandCard', () => {
	it('shows one command’s entry as the reference does, in a polite live region', () => {
		const root = dom.render(CommandCard, { command: { name: 'kick', hint: '@user [<reason>]', description: 'Remove a user from this room', required: ['mention'] } });
		expect([...root.querySelectorAll('dt, dd')].map((node) => node.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['/kick @user [<reason>]', 'Remove a user from this room', 'Required: mention']);
		expect(root.querySelector('[role="status"]')).not.toBeNull();
	});
});
