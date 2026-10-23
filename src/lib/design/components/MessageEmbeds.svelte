<script lang="ts">
	import type { Snippet } from 'svelte';
	import Embed from './Embed.svelte';
	import EmbedRemove from './EmbedRemove.svelte';
	import type { EmbedProps, MessageEmbed } from './types';

	/** A message's embeds (§4.8), under its text: a Message renders this only for a message that has some. */
	interface Props {
		embeds: MessageEmbed[];
		/** Draws one embed in place of the design system's Embed, such as with your own media gates. */
		embed?: Snippet<[MessageEmbed]>;
		/** The (x) on a removable one. */
		onremove?: (embed: EmbedProps) => void;
	}
	let { embeds, embed, onremove }: Props = $props();
</script>

<div class="ap-msg-embeds">
	{#each embeds as item (item.key)}
		<div class="ap-embed-slot">
			{#if embed}{@render embed(item)}{:else}
				<!-- spread: an embed's own fields are the Embed's props, one for one -->
				<Embed {...item.embed} progress={item.upload?.progress} failed={item.upload?.failed} />
			{/if}
			{#if item.removable}<EmbedRemove label="Remove embed" onremove={() => onremove?.(item.embed)} />{/if}
		</div>
	{/each}
</div>
