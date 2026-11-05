import { describe, expect, it } from 'vitest';
import { shortcutGroups } from './shortcuts';

const keysOf = (mac: boolean, label: string) => shortcutGroups(mac).flatMap((group) => group.shortcuts).find((shortcut) => shortcut.label === label)?.keys;

describe('shortcutGroups', () => {
	it('writes a Mac\'s modifiers as its keyboard marks them, and others\' by name', () => {
		expect(keysOf(true, 'Search local history')).toEqual([['⌘', 'F']]);
		expect(keysOf(false, 'Search local history')).toEqual([['Ctrl', 'F']]);
		expect(keysOf(true, 'Go to a room or thread')).toEqual([['⌘', 'K']]);
		expect(keysOf(false, 'Go to a room or thread')).toEqual([['Ctrl', 'K']]);
		expect(keysOf(true, 'Move a room up or down')).toEqual([['⌥', '↑'], ['⌥', '↓']]);
		expect(keysOf(false, 'New line')).toEqual([['Shift', 'Enter']]);
	});

	it('names how to show itself first, and gives every shortcut keys, each label once in its group', () => {
		const groups = shortcutGroups(false);
		expect(groups[0].shortcuts[0]).toEqual({ label: 'Show keyboard shortcuts', keys: [['?'], ['Ctrl', '/']] });
		for (const group of groups) {
			expect(group.shortcuts.length).toBeGreaterThan(0);
			expect(new Set(group.shortcuts.map((shortcut) => shortcut.label)).size).toBe(group.shortcuts.length);
			for (const shortcut of group.shortcuts) expect(shortcut.keys.every((combo) => combo.length > 0)).toBe(true);
		}
		expect(new Set(groups.map((group) => group.title)).size).toBe(groups.length);
	});
});
