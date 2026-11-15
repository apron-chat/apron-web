<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Button from '$lib/design/components/Button.svelte';
	import ConnectPage from '$lib/design/components/ConnectPage.svelte';
	import { receiveCallback } from '$lib/ui/sign-in-page';

	/**
	 * Where a server's sign-in page sends the user back (`CALLBACK_PATH`,
	 * §4.12.2): the answer goes to the tab that opened this popup, or back to
	 * the app in this tab (`receiveCallback`). What is left to say shows only
	 * where neither happened: a window the browser wouldn't let this page
	 * close, or an address with no answer in it.
	 */
	let left = $state<'popup' | 'none' | undefined>();

	onMount(() => {
		const done = receiveCallback(window.location);
		if (done === 'page') return;
		// A popup closes itself; one still open a moment later is a window this page may not close.
		if (done === 'popup') setTimeout(() => (left = 'popup'), 300);
		else left = 'none';
	});
</script>

<svelte:head>
	<title>Signing in · Apron</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<ConnectPage page>
	<div class="ap-connect-card" role="group" aria-label="Signing in">
		<h1 class="ap-connect-title">Apron</h1>
		{#if left === 'popup'}
			<p class="ap-form-hint" role="status" data-testid="signed-in-close">Done. You can close this window and go back to Apron.</p>
		{:else if left === 'none'}
			<p class="ap-form-hint" role="status">Nothing to finish here.</p>
			<div class="ap-connect-actions">
				<Button variant="primary" label="Open Apron" onclick={() => window.location.assign(resolve('/'))} />
			</div>
		{:else}
			<p class="ap-form-hint" role="status">Signing in…</p>
		{/if}
	</div>
</ConnectPage>
