<script lang="ts">
	import CommandReference from '$lib/design/components/CommandReference.svelte';
	import type { ReferenceSection } from '$lib/design/components/types';

	/**
	 * Every command the user can use (`ext:command_list`, with apron-web's own), opened by `/help` or the composer's
	 * Browse all commands: the design system's CommandReference, its sections by who may use each, which the page
	 * works out (`Commands.reference`), so that nothing of the commands' code is in the on-demand chunk.
	 */
	interface Props {
		sections: ReferenceSection[];
		/** The commands are on their way. */
		loading: boolean;
		/** Why they won't come. */
		error?: string;
		/** Asking for them anew failed: what shows may be out of date, which it says. */
		stale?: boolean;
		/** A command used, by its name: it closes, and the composer takes it. */
		onuse: (name: string) => void;
		onclose: () => void;
	}
	let { sections, loading, error, stale = false, onuse, onclose }: Props = $props();

	let open = $state(true);
</script>

<CommandReference bind:open {sections} {loading} {error} subtitle={stale ? 'The server didn’t answer: these may be out of date.' : 'Press one to use it, or type / in the composer to complete one.'} {onuse} {onclose} />
