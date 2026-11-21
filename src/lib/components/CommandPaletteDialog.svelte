<script lang="ts">
	import CommandPalette from '$lib/design/components/CommandPalette.svelte';
	import type { CommandEntry } from '$lib/ui/command-autocomplete';
	import { paletteSections } from '$lib/ui/command-palette';

	/**
	 * Every command the user can use (`ext:command_list`, with apron-web's own), opened by `/help` or the composer's
	 * Browse all commands: the design system's CommandPalette, its sections by who may use each (`paletteSections`).
	 */
	interface Props {
		/** The commands (`mergeCommands`); undefined while the server's are on their way. */
		commands: readonly CommandEntry[] | undefined;
		/** What the field starts with, such as what was typed of a command. */
		filter?: string;
		/** A reply is being written, or files are attached: commands that require them fit. */
		replying?: boolean;
		attaching?: boolean;
		/** A command picked, by its name; it closes. */
		onpick: (name: string) => void;
		onclose: () => void;
	}
	let { commands, filter = '', replying = false, attaching = false, onpick, onclose }: Props = $props();

	let open = $state(true);
	// What it starts with; typing changes it from there.
	// svelte-ignore state_referenced_locally
	let query = $state(filter);
	let sections = $derived(commands ? paletteSections(commands, query, { replying, attaching }) : []);
</script>

<CommandPalette bind:open bind:query {sections} loading={commands === undefined} {onpick} {onclose} />
