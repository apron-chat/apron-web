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
				{ label: 'Cancel the reply', where: 'While replying', keys: [['Esc']] }
			]
		},
		{
			title: 'Messages',
			shortcuts: [
				// The composer's ↑ (Composer.svelte's `key`), or windowKeydown's with nothing focused; then timelineKey.
				{ label: 'Go to the messages', where: 'In an empty composer, or with nothing focused', keys: [['↑']] },
				{ label: 'Previous or next message', where: 'On a message', keys: [['↑'], ['↓']] },
				{ label: 'Back to the composer', where: 'On a message', keys: [['Esc']] },
				{ label: 'Its links and buttons', where: 'On a message', keys: [['←'], ['→']] },
				{ label: 'Its actions', where: 'On a message', keys: [['Enter']] },
				// Message.svelte's keydown.
				{ label: 'Reply', where: 'On a message', keys: [['r']] },
				{ label: 'Edit your message', where: 'On a message', keys: [['e']] },
				{ label: 'Select it, to move it', where: 'On a message', keys: [['x']] },
				{ label: 'Select up or down from it', where: 'On a message', keys: [[shift, '↑'], [shift, '↓']] }
			]
		},
		{
			title: 'Rooms',
			shortcuts: [
				// +page.svelte's windowKeydown (room-steps.ts).
				{ label: 'Previous or next room or thread', keys: [[alt, '↑'], [alt, '↓']] },
				{ label: 'Previous or next room, past threads', keys: [[alt, shift, '↑'], [alt, shift, '↓']] },
				// Sidebar.svelte's reorderKey.
				{ label: 'Move a room up or down', where: 'On a room in the list', keys: [[alt, '↑'], [alt, '↓']] }
			]
		}
	];
}
