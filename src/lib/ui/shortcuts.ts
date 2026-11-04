import type { ShortcutGroup } from '$lib/design/components/types';

/**
 * The keyboard shortcuts the app takes, as the `?` overlay (KeyboardShortcuts) lists them. A Mac's keys are written
 * as its keyboard marks them (⌘ ⌥ ⇧), others' by name (Ctrl, Alt, Shift). Keep this in step with the handlers: each
 * entry names where its keys are taken.
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
				{ label: 'Search local history', keys: [[mod, 'F']] },
				{ label: 'Close a dialog, menu or viewer', keys: [['Esc']] }
			]
		},
		{
			title: 'Composer',
			shortcuts: [
				// DraftField's keydown (enterAction), and the composer's own keys (Composer.svelte's `key`).
				{ label: 'Send', keys: [['Enter']] },
				{ label: 'New line', keys: [[shift, 'Enter']] },
				{ label: 'Edit your last message', where: 'In an empty composer', keys: [['↑']] },
				{ label: 'Cancel the reply', where: 'While replying', keys: [['Esc']] },
				{ label: 'Previous or next suggestion', where: 'After @, # or :', keys: [['↑'], ['↓']] },
				{ label: 'Take the suggestion', where: 'After @, # or :', keys: [['Tab'], ['Enter']] }
			]
		},
		{
			title: 'Messages',
			shortcuts: [
				// Message.svelte's keydown; +page.svelte's windowKeydown ends the selection.
				{ label: 'Reply to a message', where: 'On a focused message', keys: [['r']] },
				{ label: 'Edit your message', where: 'On a focused message', keys: [['e']] },
				{ label: 'Select a message', where: 'On a focused message', keys: [['x']] },
				{ label: 'Stop selecting', where: 'While selecting', keys: [['Esc']] },
				// MessageEditor.svelte.
				{ label: 'Save an edit', where: 'While editing', keys: [['Enter']] },
				{ label: 'Cancel an edit', where: 'While editing', keys: [['Esc']] }
			]
		},
		{
			title: 'Rooms',
			shortcuts: [
				// +page.svelte's windowKeydown (room-steps.ts).
				{ label: 'Previous or next room', keys: [[alt, '↑'], [alt, '↓']] },
				{ label: 'Previous or next unread room', keys: [[alt, shift, '↑'], [alt, shift, '↓']] },
				// Sidebar.svelte's reorderKey.
				{ label: 'Move a room up or down', where: 'On a room in the list', keys: [[alt, '↑'], [alt, '↓']] },
				// SidebarLayout's handleKey, and PanelHandle's click.
				{ label: 'Resize the room list', where: 'On its border', keys: [['←'], ['→']] },
				{ label: 'Collapse or expand the room list', where: 'On its border', keys: [['Enter']] }
			]
		},
		{
			title: 'Viewers',
			shortcuts: [
				// MediaViewer.svelte.
				{ label: 'Previous or next image', where: 'In the image viewer', keys: [['←'], ['→']] },
				// TerminalScreen's keydown.
				{ label: 'Scroll the terminal', where: 'In the terminal viewer', keys: [['↑'], ['↓'], ['Page Up'], ['Page Down']] },
				{ label: 'Top or bottom of the terminal', where: 'In the terminal viewer', keys: [['Home'], ['End']] }
			]
		}
	];
}
