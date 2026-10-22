<script lang="ts">
	import { tick } from 'svelte';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import Button from '$lib/design/components/Button.svelte';
	import Callout from '$lib/design/components/Callout.svelte';
	import MenuButton from '$lib/design/components/MenuButton.svelte';
	import SettingRow from '$lib/design/components/SettingRow.svelte';
	import { pauseChoices, pausedUntilLabel, type PausedUntil } from '$lib/ui/pause';

	interface Props {
		/**
		 * Until when notifications are paused (§4.5 `mute` without `room_id`),
		 * as the server's `status` said; undefined when not. Pausing and
		 * resuming only ask: this changes when the server sends the change
		 * back, perhaps shorter, or not at all.
		 */
		until?: PausedUntil;
		/** Asks to pause; rejects with the server's error when nothing changed. */
		onpause: (until: PausedUntil) => Promise<void> | void;
		/** Asks to resume; rejects with the server's error when nothing changed. */
		onresume: () => Promise<void> | void;
	}
	let { until, onpause, onresume }: Props = $props();

	let actionBox = $state<HTMLElement | undefined>();
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
		void tick().then(() => actionBox?.querySelector<HTMLButtonElement>('button')?.focus());
	});

	/** The server refused the last pause or resume (§4.5: nothing changed): why, until the next ask. */
	let refused = $state<{ action: 'pause' | 'resume'; message: string } | undefined>();

	function ask(action: 'pause' | 'resume', request: () => Promise<void> | void): void {
		asked = action;
		refused = undefined;
		void Promise.resolve()
			.then(request)
			.catch((cause: unknown) => {
				if (asked === action) asked = undefined;
				refused = { action, message: cause instanceof Error ? cause.message : String(cause) };
			});
	}

	function pause(value: string): void {
		const choice = choices.find((entry) => entry.value === value);
		if (!choice) return;
		ask('pause', () => onpause(choice.until));
	}

	function resume(): void {
		ask('resume', onresume);
	}
</script>

<SettingRow title="Pause notifications" hint={until === undefined ? 'Silence desktop and push notifications on all your devices for a while. Only you see it.' : undefined} class="ap-pref-pause">
	{#if until !== undefined}
		<p class="ap-pref-note ap-pref-paused ap-tone-warn"><BellOff size={14} strokeWidth={1.8} aria-hidden="true" /> Paused {pausedUntilLabel(until)} · no desktop or push notifications on your devices.</p>
	{/if}
	{#if refused}
		<div class="ap-pause-refused" role="alert">
			<Callout title={refused.action === 'pause' ? 'Notifications weren’t paused' : 'Notifications are still paused'}>
				<p>{refused.message}</p>
			</Callout>
		</div>
	{/if}
	{#snippet control()}
		<div class="ap-pause-action" bind:this={actionBox}>
			{#if until !== undefined}
				<Button size="sm" variant="primary" label="Resume" onclick={resume} />
			{:else}
				<MenuButton label="Pause…" bind:open={menuOpen} {choices} onselect={pause} />
			{/if}
		</div>
	{/snippet}
</SettingRow>
