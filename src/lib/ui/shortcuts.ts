import type { ShortcutGroup } from '$lib/design/components/types';

/**
 * The keyboard shortcuts worth learning, as the `?` overlay (KeyboardShortcuts) lists them. Keys every app has are
 * left out, though they work here too: Enter to send or save, Esc to close or cancel, arrows and Tab through a list or
 * a picker's suggestions, arrows in the image and terminal viewers and on a panel's border. A Mac's keys are written as
 * its keyboard marks them (⌘ ⌥ ⇧), others' by name (Ctrl, Alt, Shift). Keep this in step with the handlers: each entry
 * names where its keys are taken.
 */
export function shortcutGroups(mac: boolean): ShortcutGroup[] {
	const mod = mac ? '⌘' : 'Ctrl';
	const alt = mac ? '⌥' : 'Alt';
	const shift = mac ? '⇧' : 'Shift';
	return [
		{
			title: 'General',
			shortcuts: [
				// +page.svelte's windowKeydown.
				{ label: 'Show keyboard shortcuts', keys: [['?'], [mod, '/']] },
				{ label: 'Search local history', keys: [[mod, 'F']] }
			]
		},
		{
			title: 'Composer',
			shortcuts: [
				// DraftField's keydown (enterAction), and the composer's own keys (Composer.svelte's `key`).
				{ label: 'New line', keys: [[shift, 'Enter']] },
				{ label: 'Edit your last message', where: 'In an empty composer', keys: [['↑']] },
				{ label: 'Cancel the reply', where: 'While replying', keys: [['Esc']] }
			]
		},
		{
			title: 'Messages',
			shortcuts: [
				// Message.svelte's keydown.
				{ label: 'Reply to a message', where: 'On a focused message', keys: [['r']] },
				{ label: 'Edit your message', where: 'On a focused message', keys: [['e']] },
				{ label: 'Select a message', where: 'On a focused message', keys: [['x']] }
			]
		},
		{
			title: 'Rooms',
			shortcuts: [
				// +page.svelte's windowKeydown (room-steps.ts).
				{ label: 'Previous or next room', keys: [[alt, '↑'], [alt, '↓']] },
				{ label: 'Previous or next unread room', keys: [[alt, shift, '↑'], [alt, shift, '↓']] },
				// Sidebar.svelte's reorderKey.
				{ label: 'Move a room up or down', where: 'On a room in the list', keys: [[alt, '↑'], [alt, '↓']] }
			]
		}
	];
}
