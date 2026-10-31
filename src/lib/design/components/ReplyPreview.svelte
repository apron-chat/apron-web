<script lang="ts">
	import Avatar from './Avatar.svelte';
	import Mention from './Mention.svelte';
	import type { MessageReply } from './types';

	/**
	 * The quote above a reply (§3.5): who wrote the message it answers and one line of it, a button that jumps there.
	 * Without the quoted message's `id` it couldn't be found, and says so.
	 */
	interface Props {
		reply: MessageReply;
		/** Go to the quoted message. */
		onjump?: (messageId: string) => void;
		'data-testid'?: string;
	}
	let { reply, onjump, 'data-testid': testid }: Props = $props();
	const name = $derived(reply.name || 'Unknown sender');
</script>

<!-- One line; inside a Message it sits on its own row above the sender's name (.ap-msg-reply), where a spine draws it from the avatar. Its mentions only read: the quote is itself a control. -->
{#if reply.id}
	<button class="ap-reply" data-testid={testid} type="button" aria-label="Replying to {name}. Jump to their message" onclick={() => onjump?.(reply.id!)}>
		<Avatar {name} src={reply.avatar} hue={reply.hue} size="xs" />
		<span class="ap-reply-who">{name}</span>
		<span class="ap-reply-text">{#if reply.deleted}<em>Message deleted</em>{:else}{#each reply.snippet ?? [] as part, index (index)}{#if typeof part === 'string'}{part}{:else if 'role' in part}<Mention role={part.role} />{:else if 'roomId' in part}<Mention roomId={part.roomId} name={part.name} thread={part.thread} hash={part.hash} />{:else}<Mention user_id={part.user_id} name={part.name} me={part.me} />{/if}{/each}{/if}</span>
	</button>
{:else}
	<div class="ap-reply ap-reply-static" data-testid={testid}>
		<span class="ap-reply-text"><em>Message unavailable</em></span>
	</div>
{/if}
