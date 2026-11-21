<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import { fades } from './fades';

	/**
	 * A room's or thread's `description` (§3.4), its first lines under the header as the conversation opens, before it is
	 * put away: rendered + sanitized Markdown as `children` (its own `.ap-msg-text`), or plain `description`, set as a
	 * document (`.ap-doc`) in the column its DescriptionSheet reads in. Four lines (three on a phone), faded where it's
	 * cut; a click on it (not on a link or a mention, nor the end of selecting its text), or Read all, opens the whole
	 * (`onexpand`). × puts it away (`ondismiss`). An edit of it not saved yet says so (`draft`), and takes it up (`ondraft`).
	 */
	interface Props {
		description?: string;
		children?: Snippet;
		/** Names the region: "Thread description" or "Room description". */
		label?: string;
		/** Offer × to put the description away. */
		ondismiss?: () => void;
		/** Open the whole description, from Read all or a click on its text. */
		onexpand?: () => void;
		/** An edit of the description is kept as a draft: Unsaved draft, which takes it up (`ondraft`). */
		draft?: boolean;
		ondraft?: () => void;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { description, children, label = 'Thread description', ondismiss, onexpand, draft = false, ondraft, class: className }: Props = $props();
	/** More of it than its first lines show: Read all. */
	let clipped = $state(false);

	/** A click on the text opens the whole, but not one on a link or mention, nor the end of selecting text. */
	function click(event: MouseEvent): void {
		if (!onexpand || (event.target as Element | null)?.closest('a, button, [data-room-id]')) return;
		if (window.getSelection()?.toString()) return;
		onexpand();
	}
</script>

<section aria-label={label} class={['ap-description', className]}>
	<!-- The pointer opens it from the text itself; the keyboard has Read all, and the header's Description. -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class={['ap-description-text', 'ap-doc', onexpand && 'ap-description-opens']} {@attach fades((on) => (clipped = on))} onclick={click}>
		{#if children}{@render children()}{:else}<div class="ap-msg-text"><p>{description}</p></div>{/if}
	</div>
	{#if (clipped && onexpand) || (draft && ondraft)}
		<div class="ap-description-foot">
			{#if draft && ondraft}<button class="ap-btn ap-btn-sm ap-btn-ghost ap-description-draft" type="button" title="Kept on this device until you save or discard it" onclick={ondraft}>Unsaved draft</button>{/if}
			{#if clipped && onexpand}<button class="ap-btn ap-btn-sm ap-btn-ghost" type="button" onclick={onexpand}><ChevronDown size={14} strokeWidth={2} aria-hidden="true" />Read all</button>{/if}
		</div>
	{/if}
	{#if ondismiss}
		<button class="ap-iconbtn ap-description-close" type="button" aria-label="Hide description" title="Hide description" onclick={ondismiss}>
			<X size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	{/if}
</section>
