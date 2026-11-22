// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import CommandCard from './CommandCard.svelte';
import * as dom from '$lib/test/dom';

describe('CommandCard', () => {
	it('shows one command’s entry as the reference does, by the ID the field it describes names', () => {
		const root = dom.render(CommandCard, { id: 'field-card', command: { name: 'kick', hint: '@user [<reason>]', description: 'Remove a user from this room', required: ['mention'] } });
		expect([...root.querySelectorAll('dt, dd')].map((node) => node.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['/kick @user [<reason>]', 'Remove a user from this room', 'Required: mention']);
		expect(root.querySelector('#field-card')?.textContent).toContain('Required: mention');
	});
});
