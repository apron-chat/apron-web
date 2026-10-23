<script lang="ts">
	import Avatar from './Avatar.svelte';
	import type { ReplyPreviewProps } from './types';
	import { chain, uid } from './util';

	let { messageId: _messageId, sender, snippet, deleted, onjump, class: className, ...rest }: ReplyPreviewProps = $props();
	const name = $derived(sender?.name || uid(sender));
</script>

<!-- One line; inside a Message it sits on its own row above the sender's name (.ap-msg-reply), where a spine draws it from the avatar. -->
<button type="button" aria-label="Replying to {name}. Jump to their message" {...rest} class={['ap-reply', className]} onclick={chain(onjump, rest.onclick)}>
	<Avatar {name} src={sender?.avatar} size="sm" />
	<span class="ap-reply-who">{name}</span>
	<span class="ap-reply-text">{#if deleted}<em>Message deleted</em>{:else}{snippet}{/if}</span>
</button>
