<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import Dialog from './Dialog.svelte';
	import type { ShortcutGroup } from './types';

	/**
	 * The keyboard shortcuts, in a centered Dialog: each group titled, each shortcut what it does (and where, when not
	 * everywhere) beside its keys, as many columns as fit. A combination's keys are written as they are on the keyboard
	 * (`⌘` `F`) and named in words for a screen reader (Command F).
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		groups: ShortcutGroup[];
		/** Under the title, such as how to open it again. */
		subtitle?: string;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
	}
	let { open = $bindable(false), groups, subtitle, onclose, class: className }: Props = $props();
	const uid = $props.id();

	/** Keys whose mark says little aloud, in words. */
	const SPOKEN: Record<string, string> = {
		'⌘': 'Command', '⌥': 'Option', '⇧': 'Shift', '⌃': 'Control', Ctrl: 'Control', Esc: 'Escape',
		'↑': 'Up arrow', '↓': 'Down arrow', '←': 'Left arrow', '→': 'Right arrow', '?': 'Question mark', '/': 'Slash'
	};
	const spoken = (combo: string[]) => combo.map((key) => SPOKEN[key] ?? key).join(' ');
</script>

<Dialog bind:open title="Keyboard shortcuts" {subtitle} size="md" backdropCloses {onclose} class={['ap-keys', className]}>
	<div class="ap-keys-groups">
		{#each groups as group, index (group.title)}
			<section class="ap-keys-group" aria-labelledby="{uid}-{index}">
				<h3 class="ap-keys-title" id="{uid}-{index}">{group.title}</h3>
				<dl class="ap-keys-list">
					{#each group.shortcuts as shortcut (shortcut.label)}
						<div class="ap-keys-row">
							<dt class="ap-keys-label">{shortcut.label}{#if shortcut.where}<span class="ap-sr">{", "}</span><span class="ap-keys-where">{shortcut.where}</span>{/if}</dt>
							<dd class="ap-keys-keys">
								{#each shortcut.keys as combo, at (at)}
									{#if at > 0}<span class="ap-keys-or">or</span>{/if}
									<kbd class="ap-keys-combo" aria-hidden="true">{#each combo as key, k (k)}<kbd class="ap-keys-key">{key}</kbd>{/each}</kbd><span class="ap-sr">{spoken(combo)}</span>
								{/each}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</Dialog>
