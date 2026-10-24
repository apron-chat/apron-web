<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import type { FeedbackState } from '$lib/ui/feedback.svelte';
	import RateLimitNotice from '$lib/design/components/RateLimitNotice.svelte';
	import StatusBanner from '$lib/design/components/StatusBanner.svelte';

	/**
	 * The page's toasts: what a request is doing or how it failed (`feedback`),
	 * in the middle, and the connection's own error at the right.
	 */
	interface Props {
		feedback: FeedbackState;
		/** The client's error, while it shows: not once dismissed, nor while reconnecting, when the banner at the top already says it. */
		error: string | undefined;
		ondismisserror: () => void;
	}
	let { feedback, error, ondismisserror }: Props = $props();
</script>

<!-- An error stays until closed or the next request; a pending line goes by itself. -->
{#snippet close(label: string, onclose: () => void)}
	<button class="ap-iconbtn ap-toast-close" type="button" aria-label={label} title="Dismiss" onclick={onclose}><X size={14} aria-hidden="true" /></button>
{/snippet}
{#if feedback.current?.wait}
	<!-- Refused for a while by a limit the page has no place for: the server's words, counting down, gone when the wait is. -->
	{@const shown = feedback.current}
	{@const wait = shown.wait!}
	<div class="ap-toast">
		<RateLimitNotice message={wait.message} since={wait.since} until={wait.until} ondismiss={() => feedback.dismiss(shown)} ondone={() => feedback.dismiss(shown)} />
	</div>
{:else if feedback.current}
	{@const failed = feedback.current.kind === 'error'}
	<div class="ap-toast">
		<StatusBanner tone={failed ? 'danger' : 'warn'} role={failed ? 'alert' : 'status'} action={failed ? dismissFeedback : undefined}>{feedback.current.text}</StatusBanner>
	</div>
{/if}
{#snippet dismissFeedback()}{@render close('Dismiss', () => feedback.clear())}{/snippet}
{#if error}
	<div class="ap-toast ap-toast-end">
		<StatusBanner tone="danger" role="alert" action={dismissClientError}>{error}</StatusBanner>
	</div>
{/if}
{#snippet dismissClientError()}{@render close('Dismiss connection error', ondismisserror)}{/snippet}
