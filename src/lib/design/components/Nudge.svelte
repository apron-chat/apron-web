<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Extra attributes go on the nudge. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** The offer, as a question: "Get notified when you’re mentioned?". */
		title: string;
		/** Why now, and what it does: "Ada mentioned you in General. …". */
		detail?: string;
		/** A quiet last line, such as where the setting lives. */
		note?: string;
		/** Drawn in an accent circle before the title, such as a bell. */
		icon?: Snippet;
		/** The buttons: a quiet Not now, then the one thing to do. */
		actions?: Snippet;
		/**
		 * Points at what it's about (the control that changes it later) from
		 * its bottom edge, `--ap-nudge-tip` from its left; none when that isn't
		 * on screen.
		 */
		pointer?: boolean;
	}
	let { title, detail, note, icon, actions, pointer = false, class: className, ...rest }: Props = $props();
	const id = $props.id();
</script>

<!--
	A small offer made once, at the moment it's useful: not modal, and it doesn't take focus from what you're doing.
	On the surface, unlike ActionBanner's accent: it asks, rather than reports something that happened.
-->
<!-- Named and described by its title and detail: that wiring is the nudge's own, so it follows the extra attributes. -->
<div role="dialog" {...rest} class={['ap-nudge', pointer && 'ap-nudge-pointer', className]} aria-labelledby="{id}-title" aria-describedby={detail ? `${id}-detail` : undefined}>
	<div class="ap-nudge-top">
		{#if icon}<span class="ap-nudge-icon" aria-hidden="true">{@render icon()}</span>{/if}
		<span class="ap-nudge-text">
			<span class="ap-nudge-title" id="{id}-title">{title}</span>
			{#if detail}<span class="ap-nudge-detail" id="{id}-detail">{detail}</span>{/if}
		</span>
	</div>
	{#if actions}<div class="ap-nudge-actions">{@render actions()}</div>{/if}
	{#if note}<p class="ap-nudge-note">{note}</p>{/if}
</div>
