<script lang="ts">
	import { tick } from 'svelte';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Button from '$lib/design/components/Button.svelte';
	import MenuButton from '$lib/design/components/MenuButton.svelte';
	import { pauseChoices, pausedUntilLabel, type PausedUntil } from '$lib/ui/pause';

	interface Props {
		/**
		 * Until when notifications are paused (§4.11 `mute`), as the server
		 * echoed it; undefined when not. Pausing and resuming only ask: this
		 * changes when the echo arrives, perhaps shorter, or not at all.
		 */
		until?: PausedUntil;
		onpause: (until: PausedUntil) => void;
		onresume: () => void;
	}
	let { until, onpause, onresume }: Props = $props();

	let row = $state<HTMLElement | undefined>();
	/** The Pause menu's choices, with when each would end, worked out as it opens. */
	let menuOpen = $state(false);
	let choices = $derived.by(() => {
		void menuOpen;
		return pauseChoices();
	});

	/** What was asked for here, until the server's echo makes it so: then focus follows. */
	let asked = $state<'pause' | 'resume' | undefined>();

	/** Pause and Resume replace each other once the echo arrives: focus moves to the one that took its place. */
	$effect(() => {
		const now = until !== undefined ? 'pause' : 'resume';
		if (asked !== now) return;
		asked = undefined;
		void tick().then(() => row?.querySelector<HTMLButtonElement>('.ap-pause-action button')?.focus());
	});

	function pause(value: string): void {
		const choice = choices.find((entry) => entry.value === value);
		if (!choice) return;
		asked = 'pause';
		onpause(choice.until);
	}

	function resume(): void {
		asked = 'resume';
		onresume();
	}
</script>

<div class="ap-pref-setting ap-pref-pause" bind:this={row}>
	<div>
		<strong>Pause notifications</strong>
		{#if until !== undefined}
			<p class="ap-pref-note ap-pref-paused"><BellOff size={14} strokeWidth={1.8} aria-hidden="true" /> Paused {pausedUntilLabel(until)} · no desktop or push notifications on your devices.</p>
		{:else}
			<p class="ap-profedit-hint">Silence desktop and push notifications on all your devices for a while.</p>
		{/if}
	</div>
	<div class="ap-pause-action">
		{#if until !== undefined}
			<Button size="sm" variant="primary" label="Resume" onclick={resume} />
		{:else}
			<MenuButton label="Pause…" bind:open={menuOpen} {choices} onselect={pause} />
		{/if}
	</div>
</div>

<style>
	.ap-pref-pause { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-4) 0; border-bottom: 1px solid var(--line); }
	.ap-pref-pause strong { font-size: 14px; }
	.ap-pref-pause p { max-width: 420px; margin: var(--space-1) 0 0; }
	.ap-pref-paused { display: flex; align-items: center; gap: var(--space-1); color: var(--warn); font-size: 13px; line-height: 19px; }
	.ap-pause-action { flex: none; }
</style>
