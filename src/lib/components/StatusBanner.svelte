<script lang="ts">
	import type { Snippet } from 'svelte';
	import DesignStatusBanner from '$lib/design/components/StatusBanner.svelte';

	interface Props {
		/** The dot's colour; every tone sits beside a word. */
		tone?: 'ok' | 'warn' | 'danger' | 'none';
		role?: 'status' | 'alert' | 'note';
		testid?: string;
		/** Announce text changes to assistive tech. */
		live?: boolean;
		children: Snippet;
		action?: Snippet;
	}
	let { tone = 'none', role = 'status', testid, live = false, children, action }: Props = $props();
</script>

<DesignStatusBanner {tone} {role} {testid} {live} {children} {action} />
