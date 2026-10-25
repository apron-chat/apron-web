<script lang="ts">
	import type { RoomQuote } from './types';
	import { roomName, roomNameTip } from './util';

	/**
	 * A room or thread a link points to (Appendix A.4), shown under the text that links it: its name, the room a thread
	 * is in, how many members it has, and up to two lines of its description. Like QuotedMessage, it is the link itself,
	 * on the same grid.
	 */
	interface Props {
		quote: RoomQuote;
		'data-testid'?: string;
	}
	let { quote, 'data-testid': testid }: Props = $props();
	const thread = $derived(Boolean(quote.room.thread || quote.parent));
	const name = $derived(roomName(quote.room.title, quote.room.id, { thread }));
	const tip = $derived(roomNameTip(quote.room.title, quote.room.id, { thread }));
	const parent = $derived(quote.parent ? roomName(quote.parent.title, quote.parent.id) : undefined);
	const members = $derived(quote.members === undefined ? undefined : `${quote.members.toLocaleString('en-US')} ${quote.members === 1 ? 'member' : 'members'}`);
	const where = $derived([thread ? (parent ? `Thread in #${parent}` : 'Thread') : 'Room', members].filter(Boolean).join(' · '));
</script>

<a class="ap-quote ap-quote-room" href={quote.href} data-testid={testid} aria-label="{thread ? 'Thread' : 'Room'} {name}. Open it">
	<span class="ap-quote-face ap-quote-glyph" aria-hidden="true">{thread ? '↳' : '#'}</span>
	<span class="ap-quote-who" title={tip}>{name}{#if quote.private}<span class="ap-quote-badge">Private</span>{/if}</span>
	<span class="ap-quote-where">{where}</span>
	{#if quote.description}<span class="ap-quote-text">{quote.description}</span>{/if}
</a>
