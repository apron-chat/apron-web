<script lang="ts">
	import Avatar from './Avatar.svelte';
	import Mention from './Mention.svelte';
	import type { MessageQuote } from './types';
	import { roomName, roomNameTip, times } from './util';

	/**
	 * A message a link points to (Appendix A.4), quoted under the text that links it: who wrote it, the room or thread
	 * it's in and when, then up to three lines of it. It is the link itself, so a click follows it as the page opens
	 * links, and a modified one as the browser does. Its parts sit on a grid (`.ap-quote`), which places them.
	 */
	interface Props {
		quote: MessageQuote;
		'data-testid'?: string;
	}
	let { quote, 'data-testid': testid }: Props = $props();
	const name = $derived(quote.name || 'Unknown sender');
	const t = $derived(times(quote.timestamp, quote.time));
	const room = $derived(quote.room ? roomName(quote.room.title, quote.room.id, { thread: quote.room.thread }) : undefined);
	const roomTip = $derived(quote.room ? roomNameTip(quote.room.title, quote.room.id, { thread: quote.room.thread }) : undefined);
	// The room as a `#room_id` mention reads: its name after a #.
	const where = $derived([room && `#${room}`, t.short].filter(Boolean).join(' · '));
</script>

<!-- Its mentions only read: the quote is itself a link. -->
<a class="ap-quote ap-quote-message" href={quote.href} data-testid={testid} aria-label="Message from {name}{room ? ` in ${room}` : ''}. Open it">
	<span class="ap-quote-face"><Avatar {name} src={quote.avatar} hue={quote.hue} size="sm" /></span>
	<span class="ap-quote-who">{name}</span>
	{#if where}<span class="ap-quote-where" title={[roomTip, t.exact].filter(Boolean).join(' · ') || undefined}>{where}</span>{/if}
	<span class="ap-quote-text">{#if quote.deleted}<em>Message deleted</em>{:else}{#each quote.snippet ?? [] as part, index (index)}{#if typeof part === 'string'}{part}{:else if 'roomId' in part}<Mention roomId={part.roomId} name={part.name} thread={part.thread} hash={part.hash} />{:else}<Mention user_id={part.user_id} name={part.name} me={part.me} />{/if}{/each}{/if}</span>
</a>
