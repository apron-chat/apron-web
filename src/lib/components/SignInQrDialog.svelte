<script lang="ts">
	import Button from '$lib/design/components/Button.svelte';
	import Dialog from '$lib/design/components/Dialog.svelte';
	import { qrCode } from '$lib/ui/qr-code';

	interface Props {
		/** A sign-in link from a `~private` notice, as the server wrote it (`offerSignInQr`). */
		href: string;
		onclose: () => void;
	}
	let { href, onclose }: Props = $props();

	let open = $state(true);
	let code = $derived(qrCode(href));
	/** The quiet zone a scanner needs around the code, in modules. */
	const QUIET = 4;
</script>

<Dialog bind:open title="Sign in on another device" backdropCloses {onclose}>
	{#if code}
		<!-- A scanner reads dark on light, so the code stays black on white in either theme. -->
		<svg class="ap-qr" viewBox="{-QUIET} {-QUIET} {code.size + 2 * QUIET} {code.size + 2 * QUIET}" shape-rendering="crispEdges" role="img" aria-label="QR code of the sign-in link">
			<rect x={-QUIET} y={-QUIET} width={code.size + 2 * QUIET} height={code.size + 2 * QUIET} fill="#fff" />
			<path d={code.path} fill="#000" />
		</svg>
		<p>Scan it with an Apron app on your other device to sign in there.</p>
	{:else}
		<p>This link is too long for a QR code. Open it on your other device instead.</p>
	{/if}
	<p class="ap-dialog-note ap-tone-danger">Anyone who scans this code can sign in as you. Show it only to your own devices.</p>
	{#snippet footer()}
		<Button size="sm" variant="primary" label="Done" onclick={() => (open = false)} />
	{/snippet}
</Dialog>
