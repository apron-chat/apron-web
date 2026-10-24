<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import X from '@lucide/svelte/icons/x';
	import type { ClassValue } from 'svelte/elements';
	import StatusBanner from './StatusBanner.svelte';
	import { secondNow } from './clock.svelte';
	import type { LimitScope } from './types';
	import { LONG_WAIT_MS, waitLabel, waitWords } from './util';

	interface Props {
		/**
		 * What the wait holds back, which picks the words: `history` (pages of a room's history), `message` (sending), or
		 * `upload` (sending files). The words say what waits, never why: the server asked for the wait (`retry_after`),
		 * and says no more.
		 */
		scope: LimitScope;
		/** When the wait is over, in epoch milliseconds (`retry_after` from when it was asked): it counts down to that, so re-rendering never drifts. */
		until: number;
		/** A long wait (an hour or more): its × puts the notice away, since the wait outlasts the visit. */
		ondismiss?: () => void;
		/** Classes for the notice, added to its own. */
		class?: ClassValue;
	}
	let { scope, until, ondismiss, class: className }: Props = $props();

	/** What the wait holds back, then what happens when it's over: the time left goes after the second. */
	const WORDS: Record<LimitScope, [string, string, string]> = {
		history: ['Loading history is paused.', 'Loading again in', ''],
		message: ['Sending is paused.', 'You can send again in', '.'],
		upload: ['Uploads are paused.', 'Uploads resume in', '.']
	};
	const words = $derived(WORDS[scope]);
	/** When this notice first showed this wait: the ring's full circle. */
	const start = $derived.by(() => {
		void until;
		return Date.now();
	});
	const long = $derived(until - start >= LONG_WAIT_MS);
	const left = $derived(Math.max(0, until - secondNow()));
	/** Said once for each wait, not at every tick: the time a screen reader hears is the wait as it began. */
	const spoken = $derived(waitWords(until - start, long));
	/** The ring: r = 7, so its length is 2π·7. It empties as the wait runs out. */
	const RING = 2 * Math.PI * 7;
	const gone = $derived(RING * (1 - Math.min(1, left / Math.max(1, until - start))));
</script>

{#snippet dismiss()}
	<button type="button" class="ap-iconbtn ap-wait-close" aria-label="Dismiss" title="Dismiss" onclick={ondismiss}><X size={14} aria-hidden="true" /></button>
{/snippet}
<StatusBanner class={['ap-wait', className]} action={long && ondismiss ? dismiss : undefined}>
	{#snippet icon()}
		{#if long}
			<Clock class="ap-wait-clock" size={16} strokeWidth={2} aria-hidden="true" />
		{:else}
			<svg class="ap-wait-ring" viewBox="0 0 22 22" aria-hidden="true">
				<circle class="ap-wait-track" cx="11" cy="11" r="7" />
				<circle class="ap-wait-fill" cx="11" cy="11" r="7" stroke-dasharray={RING} stroke-dashoffset={gone} transform="rotate(-90 11 11)" />
			</svg>
		{/if}
	{/snippet}
	{words[0]} <span class="ap-wait-time" aria-hidden="true">{words[1]} {waitLabel(left, long)}{words[2]}</span><span class="ap-sr">{words[1]} {spoken}{words[2]}</span>
</StatusBanner>
