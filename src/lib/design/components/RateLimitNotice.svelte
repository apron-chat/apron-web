<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import X from '@lucide/svelte/icons/x';
	import type { ClassValue } from 'svelte/elements';
	import { secondNow } from './clock.svelte';
	import type { LimitScope } from './types';
	import { LONG_WAIT_MS, punctuated, waitLabel, waitWords } from './util';

	interface Props {
		/**
		 * What the wait holds back, which picks the words: `history` (pages of a room's history), `post` (sending), or
		 * `upload`. Leave it out for a limit of any other kind, with the server's `message`.
		 */
		scope?: LimitScope;
		/** The server's message, for a limit of no known scope: shown as a sentence, then "Try again in …". */
		message?: string;
		/** When the wait is over, in epoch milliseconds (`retry_after` from when it was asked): it counts down to that, so re-rendering never drifts. */
		until: number;
		/** When the wait began, in epoch milliseconds: the ring's full circle. By default, when this notice first showed it. */
		since?: number;
		/** A long wait (an hour or more): its × puts the notice away, since the wait outlasts the visit. */
		ondismiss?: () => void;
		/** Called once the wait is over, such as to take the notice away. */
		ondone?: () => void;
		/** Classes for the notice, added to its own. */
		class?: ClassValue;
	}
	let { scope, message, until, since, ondismiss, ondone, class: className }: Props = $props();

	/** Where the ring starts: the wait's start, else when this notice first showed this wait. */
	const start = $derived.by(() => {
		void until;
		return since ?? Date.now();
	});
	const long = $derived(until - start >= LONG_WAIT_MS);
	const left = $derived(Math.max(0, until - secondNow()));
	/** What the wait holds back, then what happens when it's over: the time left goes after the second. */
	const words = $derived.by((): [string, string, string] => {
		if (scope === 'history') return ['Too many history requests just now.', 'Loading again in', ''];
		if (scope === 'post') return [long ? 'Daily posting limit reached.' : 'You’re sending messages quickly.', 'You can send again in', '.'];
		if (scope === 'upload') return [long ? 'Daily upload limit reached.' : 'Too many uploads just now.', 'Uploads resume in', '.'];
		return [punctuated(message || 'Too many requests'), 'Try again in', ''];
	});
	/** Said once for each wait, not at every tick: the time a screen reader hears is the wait as it began. */
	const spoken = $derived(waitWords(until - Date.now(), long));
	/** The ring: r = 7, so its length is 2π·7. It empties as the wait runs out. */
	const RING = 2 * Math.PI * 7;
	const gone = $derived(RING * (1 - Math.min(1, left / Math.max(1, until - start))));

	$effect(() => {
		if (!ondone) return;
		const done = ondone;
		const timer = setTimeout(done, Math.max(0, until - Date.now()));
		return () => clearTimeout(timer);
	});
</script>

<div role="status" class={['ap-wait', long && ondismiss && 'ap-wait-long', className]}>
	{#if long}
		<Clock class="ap-wait-clock" size={16} strokeWidth={2} aria-hidden="true" />
	{:else}
		<svg class="ap-wait-ring" viewBox="0 0 22 22" aria-hidden="true">
			<circle class="ap-wait-track" cx="11" cy="11" r="7" />
			<circle class="ap-wait-fill" cx="11" cy="11" r="7" stroke-dasharray={RING} stroke-dashoffset={gone} transform="rotate(-90 11 11)" />
		</svg>
	{/if}
	<span class="ap-wait-text">{words[0]} <span class="ap-wait-time" aria-hidden="true">{words[1]} {waitLabel(left, long)}{words[2]}</span><span class="ap-sr">{words[1]} {spoken}{words[2]}</span></span>
	{#if long && ondismiss}
		<button type="button" class="ap-iconbtn ap-wait-close" aria-label="Dismiss" title="Dismiss" onclick={ondismiss}><X size={14} aria-hidden="true" /></button>
	{/if}
</div>
