<script lang="ts">
	import Avatar from './Avatar.svelte';
	import type { ReplyPreviewProps } from './types';
	import { uid } from './util';

	let { sender, snippet, deleted, onjump }: ReplyPreviewProps = $props();
	const name = $derived(sender?.name || uid(sender));
</script>

<button type="button" class="ap-reply" onclick={onjump} aria-label="Replying to {name}. Jump to their message">
	<span class="ap-reply-who"><Avatar {name} src={sender?.avatar} size="sm" />{name}</span>
	<span class="ap-reply-text">{#if deleted}<em>Message deleted</em>{:else}{snippet}{/if}</span>
</button>
