<script lang="ts">
	import Avatar from './Avatar.svelte';
	import type { ReplyPreviewProps } from './types';
	import { uid } from './util';

	let { sender, snippet, deleted, onjump }: ReplyPreviewProps = $props();
	const name = $derived(sender?.name || uid(sender));
</script>

<!-- One line; inside a Message it sits on its own row above the sender's name (.ap-msg-reply), where a spine draws it from the avatar. -->
<button type="button" class="ap-reply" onclick={onjump} aria-label="Replying to {name}. Jump to their message">
	<Avatar {name} src={sender?.avatar} size="sm" />
	<span class="ap-reply-who">{name}</span>
	<span class="ap-reply-text">{#if deleted}<em>Message deleted</em>{:else}{snippet}{/if}</span>
</button>
