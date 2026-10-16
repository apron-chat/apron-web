<script lang="ts">
	interface Props {
		/** The thread's summary (its `description`, §3.4) as text, marked by a text icon. */
		summary?: string;
		/** Its newest message, on the line after the summary, marked by a reply arrow: its sender, then its text on one line. */
		latest?: { sender?: string; text: string };
		/** How many lines the summary may take, its line breaks kept; one (the default) runs it together on a line. */
		summaryLines?: number;
		/** Prefix for the lines' `data-testid`: `<testid>-summary` and `<testid>-latest`. */
		testid?: string;
	}
	let { summary, latest, summaryLines = 1, testid }: Props = $props();
	/** Shared by a thread's sidebar row (RoomItem) and its card in the room (ThreadMarker), so the two preview it alike. */
	const multi = $derived(summaryLines > 1);
	const summaryText = $derived(multi ? summary?.trim() : summary?.replace(/\s+/g, ' ').trim());
</script>

{#if summaryText}<span class={['ap-tline', 'ap-tline-summary', multi && 'ap-tline-multi']} style:--ap-tline-lines={multi ? summaryLines : undefined} data-testid={testid && `${testid}-summary`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Summary"><path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" /></svg><span class="ap-tline-text">{summaryText}</span></span>{/if}{#if latest}<span class="ap-tline ap-tline-latest" data-testid={testid && `${testid}-latest`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Latest message"><path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></svg><span class="ap-tline-text">{#if latest.sender}<span class="ap-tline-sender">{latest.sender}</span>{' '}{/if}{latest.text}</span></span>{/if}
