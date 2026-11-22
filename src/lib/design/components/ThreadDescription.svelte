<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import X from '@lucide/svelte/icons/x';
	import { fades } from './fades';

	/**
	 * A room's or thread's `description` (§3.4), its first lines under the header as the conversation opens, until it is
	 * read whole or put away: rendered + sanitized Markdown as `children` (its own `.ap-msg-text`), or plain `description`,
	 * set as a document (`.ap-doc`) in the column its DescriptionSheet reads in, on the sheet's raised ground, as the sheet
	 * folded, the description icon in its top left corner as × is in its top right. Four lines (six on a phone, which is
	 * narrower), with its chevron at its foot however short it is, as the whole has more to it (Edit, and ⌃ to fold it
	 * back); cut off, its text runs on under that foot, a bar fading into it. The whole of it
	 * is what opens the rest (`onexpand`): it lifts a shade under the pointer, and a click on it (not on a link or a
	 * mention, nor the end of selecting its text) opens it; its chevron, named Read all, is the keyboard's way. × puts it
	 * away (`ondismiss`). An edit of it not saved yet says so (`draft`), and takes it up (`ondraft`).
	 */
	interface Props {
		description?: string;
		children?: Snippet;
		/** Names the region: "Thread description" or "Room description". */
		label?: string;
		/** Offer × to put the description away. */
		ondismiss?: () => void;
		/** Open the whole description, from Read all or a click on it: called with the click (`detail` 0 from the keyboard). */
		onexpand?: (event: MouseEvent) => void;
		/** An edit of the description is kept as a draft: Unsaved draft, which takes it up (`ondraft`). */
		draft?: boolean;
		ondraft?: () => void;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { description, children, label = 'Thread description', ondismiss, onexpand, draft = false, ondraft, class: className }: Props = $props();
	/** More of it than its first lines show: its foot (the chevron, Unsaved draft) lies over its last lines, faded. */
	let clipped = $state(false);

	/** A click on it opens the whole, but not one on a link, a mention or a button, nor the end of selecting text. */
	function click(event: MouseEvent): void {
		if (!onexpand || (event.target as Element | null)?.closest('a, button, [data-room-id]')) return;
		if (window.getSelection()?.toString()) return;
		onexpand(event);
	}
</script>

<!-- The pointer opens it from anywhere on it; the keyboard has its chevron, Read all, and the header's Description. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<section aria-label={label} class={['ap-description', onexpand && 'ap-description-opens', clipped && 'ap-description-clipped', (onexpand || (draft && ondraft)) && 'ap-description-footed', className]} onclick={click}>
	<!-- The region's label already says it's a description; the icon's title says so to the pointer. -->
	<span class="ap-description-icon" title={label}><TextAlignStart size={15} strokeWidth={2} aria-hidden="true" /></span>
	<div class="ap-description-text ap-doc" {@attach fades((on) => (clipped = on))}>
		{#if children}{@render children()}{:else}<div class="ap-msg-text"><p>{description}</p></div>{/if}
	</div>
	{#if onexpand || (draft && ondraft)}
		<div class="ap-description-foot">
			{#if draft && ondraft}<button class="ap-btn ap-btn-sm ap-btn-ghost ap-description-draft" type="button" title="Kept on this device until you save or discard it" onclick={ondraft}>Unsaved draft</button>{/if}
			{#if onexpand}<button class="ap-iconbtn ap-description-more" type="button" aria-label="Read all" title="Read all" onclick={onexpand}><ChevronDown size={18} strokeWidth={2} aria-hidden="true" /></button>{/if}
		</div>
	{/if}
	{#if ondismiss}
		<button class="ap-iconbtn ap-description-close" type="button" aria-label="Hide description" title="Hide description" onclick={ondismiss}>
			<X size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	{/if}
</section>
