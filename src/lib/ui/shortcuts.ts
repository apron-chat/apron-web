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
				{ label: 'Show shortcuts', keys: [['?'], [mod, '/']] },
				{ label: 'Search rooms and threads', keys: [[mod, 'K']] },
				{ label: 'Search messages', keys: [[mod, 'F']] }
			]
		},
		{
			title: 'Rooms',
			shortcuts: [
				// +page.svelte's windowKeydown (room-steps.ts).
				{ label: 'Previous or next', keys: [[alt, '↑'], [alt, '↓']] },
				{ label: 'Previous or next, skipping threads', keys: [[alt, shift, '↑'], [alt, shift, '↓']] },
				// Sidebar.svelte's reorderKey.
				{ label: 'Move up or down', where: 'In the list', keys: [[alt, '↑'], [alt, '↓']] },
				// SearchDialog's fieldKey.
				{ label: 'Search threads', where: 'In search results', keys: [['→']] }
			]
		},
		{
			title: 'Composer',
			shortcuts: [
				// DraftField's keydown (enterAction), and the composer's own keys (Composer.svelte's `key`).
				{ label: 'New line', keys: [[shift, 'Enter']] },
				{ label: 'Cancel reply', keys: [['Esc']] },
				// Composer.svelte's `key`; windowKeydown takes ↑ too with nothing focused.
				{ label: 'Go to messages', where: 'When empty', keys: [['↑']] }
			]
		},
		{
			title: 'Full panel',
			shortcuts: [
				// DraftField's keydown (`newlineOnEnter`), and Composer.svelte's `key`.
				{ label: 'Send', keys: [[mod, 'Enter']] },
				{ label: 'Close', keys: [['Esc']] }
			]
		},
		{
			title: 'Messages',
			where: 'On a message',
			shortcuts: [
				// timelineKey.
				{ label: 'Previous or next', keys: [['↑'], ['↓']] },
				{ label: 'Back to composer', keys: [['Esc']] },
				{ label: 'Links and buttons', keys: [['←'], ['→']] },
				{ label: 'Actions', keys: [['Enter']] },
				// Message.svelte's keydown.
				{ label: 'Reply', keys: [['r']] },
				{ label: 'Edit', where: 'Yours only', keys: [['e']] },
				{ label: 'Select to move', keys: [['x']] },
				{ label: 'Select up or down', keys: [[shift, '↑'], [shift, '↓']] }
			]
		}
	];
}
