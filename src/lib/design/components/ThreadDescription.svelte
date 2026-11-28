<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import X from '@lucide/svelte/icons/x';
	import { pencil } from './Icons.svelte';
	import { fades } from './fades';

	/**
	 * A room's or thread's `description` (§3.4), its first lines under the header as the conversation opens, until it is
	 * read whole or put away: rendered + sanitized Markdown as `children` (its own `.ap-msg-text`), or plain `description`,
	 * set as a document (`.ap-doc`) in the column its DescriptionSheet reads in, on the sheet's raised ground, as the sheet
	 * folded, the description icon in its top left corner as × is in its top right. Four lines (six on a phone, which is
	 * narrower). Cut off, its text runs on under its foot, a bar fading into it, with Read all there; then the whole of it
	 * is what opens the rest (`onexpand`): it lifts a shade under the pointer, and a click on it (not on a link or a
	 * mention, nor the end of selecting its text) opens it, Read all being the keyboard's way. Not cut off, it is all there
	 * is to read: no foot, and a click on it does nothing. A pencil beside × edits it (`onedit`), × puts it away
	 * (`ondismiss`). An edit of it not saved yet says so (`draft`), and takes it up (`ondraft`).
	 */
	interface Props {
		description?: string;
		children?: Snippet;
		/** Names the region: "Thread description" or "Room description". */
		label?: string;
		/** Offer × to put the description away. */
		ondismiss?: () => void;
		/** Cut off, open the whole description, from Read all or a click on it: called with the click (`detail` 0 from the keyboard). */
		onexpand?: (event: MouseEvent) => void;
		/** Offer the pencil beside × to edit the description. */
		onedit?: () => void;
		/** Hears whether its first lines are cut off, as measured and as that changes. */
		onclip?: (clipped: boolean) => void;
		/** An edit of the description is kept as a draft: Unsaved draft, which takes it up (`ondraft`). */
		draft?: boolean;
		ondraft?: () => void;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { description, children, label = 'Thread description', ondismiss, onexpand, onedit, onclip, draft = false, ondraft, class: className }: Props = $props();
	/** More of it than its first lines show: Read all at its foot, over its last lines, faded; and it opens the whole. */
	let clipped = $state(false);
	let opens = $derived(Boolean(onexpand) && clipped);
	/** Unsaved draft shows: a row is kept for it at its foot. */
	let drafted = $derived(draft && Boolean(ondraft));

	/** Cut off, a click on it opens the whole, but not one on a link, a mention or a button, nor the end of selecting text. */
	function click(event: MouseEvent): void {
		if (!onexpand || !clipped || (event.target as Element | null)?.closest('a, button, [data-room-id]')) return;
		if (window.getSelection()?.toString()) return;
		onexpand(event);
	}
</script>

<!-- Cut off, the pointer opens it from anywhere on it; the keyboard has Read all, and the header's Description. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<section aria-label={label} class={['ap-description', opens && 'ap-description-opens', clipped && 'ap-description-clipped', drafted && 'ap-description-footed', onedit && 'ap-description-edits', className]} onclick={click}>
	<!-- The region's label already says it's a description; the icon's title says so to the pointer. -->
	<span class="ap-description-icon" title={label}><TextAlignStart size={15} strokeWidth={2} aria-hidden="true" /></span>
	<div class="ap-description-text ap-doc" {@attach fades((on) => ((clipped = on), onclip?.(on)))}>
		{#if children}{@render children()}{:else}<div class="ap-msg-text"><p>{description}</p></div>{/if}
	</div>
	{#if opens || drafted}
		<div class="ap-description-foot">
			{#if drafted}<button class="ap-btn ap-btn-sm ap-btn-ghost ap-description-draft" type="button" title="Kept on this device until you save or discard it" onclick={ondraft}>Unsaved draft</button>{/if}
			{#if opens}<button class="ap-btn ap-btn-sm ap-btn-ghost ap-description-more" type="button" onclick={onexpand}>Read all<ChevronDown size={16} strokeWidth={2} aria-hidden="true" /></button>{/if}
		</div>
	{/if}
	{#if onedit}
		<button class="ap-iconbtn ap-description-edit" type="button" aria-label="Edit description" title="Edit description" onclick={onedit}>
			<!-- Static markup (Icons), not lucide's component: drawn with each room's or thread's first lines (perf budget: open-thread). -->
			{@render pencil()}
		</button>
	{/if}
	{#if ondismiss}
		<button class="ap-iconbtn ap-description-close" type="button" aria-label="Hide description" title="Hide description" onclick={ondismiss}>
			<X size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	{/if}
</section>
