<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import HousePlus from '@lucide/svelte/icons/house-plus';
	import Share from '@lucide/svelte/icons/share';
	import SquarePlus from '@lucide/svelte/icons/square-plus';
	import Button from '$lib/design/components/Button.svelte';
	import Nudge from '$lib/design/components/Nudge.svelte';
	import type { InstallWay } from '$lib/ui/install';

	interface Props {
		/** How this browser installs Apron. */
		way: InstallWay;
		/** Installed, Apron can alert this device while it's closed, which it can't before (an iPhone or iPad's). */
		alerts?: boolean;
		/** Install, where the browser offers it (`prompt`): asks the browser from this tap. */
		oninstall: () => void;
		/** Not now, Got it once the steps are read, or Escape: answered, so it isn't offered again. */
		ondecline: () => void;
	}
	let { way, alerts = false, oninstall, ondecline }: Props = $props();

	/** The steps are showing, after Show me how: the browser can't be asked, so they say where to go. */
	let showingSteps = $state(false);

	let detail = $derived(
		way === 'in-app'
			? 'This app’s browser can’t, so open Apron in your browser first.'
			: `It opens full screen, like an app${alerts ? ', and can alert you when it’s closed' : ''}.`
	);

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		ondecline();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="install-prompt" onkeydown={keydown}>
	<Nudge title="Add Apron to your Home Screen?" {detail} testid="install-prompt">
		{#snippet icon()}<HousePlus size={16} strokeWidth={2} />{/snippet}
		{#if showingSteps}
			<ol class="ap-nudge-steps" data-testid="install-steps">
				{#if way === 'ios-safari'}
					<li>Tap <b><Share class="ap-nudge-glyph" aria-hidden="true" />Share</b> (in Safari’s <Ellipsis class="ap-nudge-glyph" aria-label="More" /> menu, if it isn’t in the toolbar)</li>
					<li>Choose <b><SquarePlus class="ap-nudge-glyph" aria-hidden="true" />Add to Home Screen</b></li>
					<li>Tap <b>Add</b></li>
				{:else if way === 'ios-browser'}
					<li>Tap <b><Share class="ap-nudge-glyph" aria-hidden="true" />Share</b>, by the address or in the browser’s menu</li>
					<li>Choose <b><SquarePlus class="ap-nudge-glyph" aria-hidden="true" />Add to Home Screen</b></li>
					<li>Tap <b>Add</b></li>
				{:else if way === 'android'}
					<li>Open the browser’s menu <EllipsisVertical class="ap-nudge-glyph" aria-label="Menu" /></li>
					<li>Choose <b>Install app</b> or <b>Add to Home screen</b></li>
					<li>Confirm with <b>Install</b></li>
				{:else}
					<li>Open this app’s menu (<Ellipsis class="ap-nudge-glyph" aria-label="More" /> or <EllipsisVertical class="ap-nudge-glyph" aria-label="Menu" />) and choose <b>Open in browser</b></li>
					<li>From there, add Apron to your Home Screen</li>
				{/if}
			</ol>
		{/if}
		{#snippet actions()}
			{#if way === 'prompt'}
				<Button size="sm" variant="ghost" label="Not now" onclick={ondecline} />
				<Button size="sm" variant="primary" label="Install" onclick={oninstall} />
			{:else if showingSteps}
				<Button size="sm" variant="primary" label="Got it" onclick={ondecline} />
			{:else}
				<Button size="sm" variant="ghost" label="Not now" onclick={ondecline} />
				<Button size="sm" variant="primary" label="Show me how" onclick={() => (showingSteps = true)} />
			{/if}
		{/snippet}
	</Nudge>
</div>

