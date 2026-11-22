<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import CommandEntry from './CommandEntry.svelte';
	import Dialog from './Dialog.svelte';
	import type { ReferenceSection } from './types';

	/**
	 * Every command the user can use, in a centered Dialog, read as a document, as the keyboard shortcuts are: a heading
	 * per section (who may use them), and under it each command's `/name` and hint as code, then its description, and
	 * a label of what it fails without ("Required: reply"); a command's forms (`emoji add`) are entries like any.
	 * With `onuse`, a command's code is a button that uses it, Tab going through them in order.
	 */
	interface Props {
		/** Shown as a centered modal while true; bindable, and set false however it closes. */
		open?: boolean;
		sections: ReferenceSection[];
		/** The commands are on their way: it says so. */
		loading?: boolean;
		/** They couldn't be had: it says why, in place of them. */
		error?: string;
		/** Under the title, such as how to complete a command. */
		subtitle?: string;
		/**
		 * A command used: given, each command's `/name` and hint is a button ("Use /name") that calls it with the name
		 * and closes. It reads as the document's text all the same.
		 */
		onuse?: (name: string) => void;
		/** It closed, whichever way. */
		onclose?: () => void;
		/** Classes for its Dialog's `<dialog>`, added to its own. */
		class?: ClassValue;
	}
	let { open = $bindable(false), sections, loading = false, error, subtitle, onuse, onclose, class: className }: Props = $props();

	function use(name: string): void {
		onuse?.(name);
		open = false;
	}
	const uid = $props.id();
</script>

<Dialog bind:open title="Commands" {subtitle} size="md" backdropCloses {onclose} class={['ap-cmdref', className]}>
	{#if sections.length}
		<!-- Sections spaced as the keyboard shortcuts' groups, rather than by the body's gap. -->
		<div>
			{#each sections as section, index (section.title)}
				<section class="ap-keys-group" aria-labelledby="{uid}-{index}">
					<h3 class="ap-keys-title" id="{uid}-{index}">{section.title}</h3>
					<dl class="ap-keys-list">
						{#each section.commands as command (command.name)}
							<CommandEntry {command} onuse={onuse ? use : undefined} />
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	{:else}
		<p>{error ?? (loading ? 'Loading commands…' : 'No commands.')}</p>
	{/if}
</Dialog>
