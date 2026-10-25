<script lang="ts">
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import Hash from '@lucide/svelte/icons/hash';
	import Lock from '@lucide/svelte/icons/lock';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Avatar from './Avatar.svelte';
	import Mention from './Mention.svelte';
	import type { LinkCardPlace, MessageLinkCard } from './types';
	import { roomName, roomNameTip, times } from './util';

	/**
	 * A link to a message, room or thread (Appendix A.4) as a card under the text, in a link preview's shape
	 * (EmbedCard's classes): its site line is the path, server › room, ending in what it is; its title is who sent the
	 * message or the room's name; its description the message's first lines or the room's. Each shows only where it's
	 * known, so a message not loaded here is its path alone. It is the link itself, so a click follows it as the page
	 * opens links, and a modified one as the browser does.
	 */
	interface Props {
		card: MessageLinkCard;
		'data-testid'?: string;
	}
	let { card, 'data-testid': testid }: Props = $props();
	const KIND = { message: 'Message', room: 'Room', thread: 'Thread' };
	const named = (place: LinkCardPlace) => (place.unknown ? place.id : roomName(place.title, place.id, { thread: place.thread }));
	const t = $derived(times(card.timestamp, card.time));
	const where = $derived(card.in ? named(card.in) : undefined);
	const room = $derived(card.room ? named(card.room) : undefined);
	const members = $derived(card.members === undefined ? undefined : `${card.members.toLocaleString('en-US')} ${card.members === 1 ? 'member' : 'members'}`);
	const label = $derived([KIND[card.kind], card.sender ? `from ${card.sender.name}` : room && `${card.kind === 'thread' ? '' : '#'}${room}`, where && `in #${where}`, `on ${card.server}`].filter(Boolean).join(' '));
</script>

{#snippet step(place: LinkCardPlace, hash: boolean)}
	{@const tip = place.unknown ? undefined : roomNameTip(place.title, place.id, { thread: place.thread })}
	<span class={['ap-linkcard-step', place.unknown ? 'ap-linkcard-id' : 'ap-linkcard-known']} title={tip}>{hash && !place.unknown ? '#' : ''}{named(place)}</span>
{/snippet}

<!-- Its mentions only read: the card is itself a link. -->
<a class={['ap-embed', 'ap-embed-ogcard', 'ap-linkcard', `ap-linkcard-${card.kind}`]} href={card.href} data-testid={testid} aria-label="{label}. Open it">
	<span class="ap-embed-cardtext">
		<span class="ap-embed-site ap-linkcard-path">
			<span class="ap-linkcard-step">{card.server}</span><span class="ap-linkcard-sep" aria-hidden="true">›</span>
			{#if card.in}{@render step(card.in, true)}<span class="ap-linkcard-sep" aria-hidden="true">›</span>{/if}
			<span class="ap-linkcard-kind">
				{#if card.kind === 'message'}<MessageSquare aria-hidden="true" />{:else if card.kind === 'thread'}<CornerDownRight aria-hidden="true" />{:else}<Hash aria-hidden="true" />{/if}
				{KIND[card.kind]}{#if members}<span class="ap-linkcard-count">{` · ${members}`}</span>{/if}
			</span>
		</span>
		{#if card.sender}
			<span class="ap-embed-title ap-linkcard-title"><Avatar name={card.sender.name} src={card.sender.avatar} hue={card.sender.hue} size="xs" /><span class="ap-linkcard-name">{card.sender.name}</span>{#if t.short}<time datetime={t.iso} title={t.exact}>{t.short}</time>{/if}</span>
		{:else if card.room}
			<span class="ap-embed-title ap-linkcard-title">{@render step(card.room, card.kind === 'room')}{#if card.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>
		{/if}
		{#if card.deleted}<span class="ap-embed-desc ap-linkcard-text"><em>Message deleted</em></span>
		{:else if card.snippet?.length}<span class="ap-embed-desc ap-linkcard-text">{#each card.snippet as part, index (index)}{#if typeof part === 'string'}{part}{:else if 'roomId' in part}<Mention roomId={part.roomId} name={part.name} thread={part.thread} hash={part.hash} />{:else}<Mention user_id={part.user_id} name={part.name} me={part.me} />{/if}{/each}</span>
		{:else if card.description}<span class="ap-embed-desc ap-linkcard-text">{card.description}</span>{/if}
	</span>
</a>
