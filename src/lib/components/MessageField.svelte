<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import ComposerEditable from '$lib/design/components/ComposerEditable.svelte';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import { DraftField } from '$lib/ui/draft-field.svelte';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import AutocompletePicker from './AutocompletePicker.svelte';

	/**
	 * Where a message is written, in the composer and in the message editor
	 * alike: the design system's `ComposerEditable` with mentions as chips
	 * (`@user_id` in the text, Appendix A.3), and the autocomplete for `@`
	 * people, `#` rooms and `:` emoji, its picker anchored to the nearest
	 * positioned box around the field (`DraftField` does the work).
	 */
	interface Props extends Omit<ComponentProps<typeof ComposerEditable>, 'element' | 'empty' | 'onbeforeinput' | 'oninput' | 'oncompositionend' | 'onkeydown' | 'onkeyup' | 'onclick' | 'onblur'> {
		/** The draft as sent; `bind:value`. Set from outside, its `@user_id`s show as chips. */
		value: string;
		/** The `user_id`s its chips mention, for `body.mentions` (§3.5); `bind:mentions`. */
		mentions?: string[];
		/** Who an `@` can name. */
		people: MentionPerson[];
		/** Rooms and threads a `#` can name. */
		rooms?: RoomSuggestion[];
		/** More `user_id`s that are people, such as those a message being edited mentions: an `@` of one is a chip. */
		known?: string[];
		/** Enter where it sends or saves (`enterAction`), with no picker taking it. */
		onsubmit: () => void;
		/** The draft changed by typing or a pick, not set from outside. */
		oninput?: () => void;
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
		/** A `data-testid` for the people's picker. */
		pickerTestid?: string;
	}
	let { value = $bindable(), mentions = $bindable([]), people, rooms = [], known, disabled = false, onsubmit, oninput, onmention, pickerTestid, ...rest }: Props = $props();

	/** Unique per field, for its picker's ID. */
	const uid = $props.id();
	const draft = new DraftField({
		get value() { return value; },
		set value(text) { value = text; },
		get mentions() { return mentions; },
		set mentions(ids) { mentions = ids; },
		get people() { return people; },
		get rooms() { return rooms; },
		get known() { return known; },
		get disabled() { return disabled; },
		submit: () => onsubmit(),
		oninput: () => oninput?.(),
		onmention: () => onmention?.()
	}, `${uid}-suggestions`);

	/** Focuses the field, the caret at the end unless it is in there already (or, with `end`, wherever it is). */
	export function focus(end = false): void {
		draft.focus(end);
	}

	/** Puts a mention chip for this user where the caret was (else at the end), as picking them would, and focuses the field. */
	export function mention(userId: string): void {
		draft.mention(userId);
	}

	/** Puts text (a picked emoji) where the caret was, over any selection. */
	export function insert(text: string): void {
		draft.insert(text);
	}

	/** Closes the picker: the field is changing under it. */
	export function reset(): void {
		draft.reset();
	}

	/** Before the draft goes (sent or saved): the picker closes and a mention it ends with becomes a chip. */
	export function finish(): void {
		draft.finish();
	}
</script>

{#if draft.pickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.query ?? ''} people={draft.matches} active={draft.activeIndex} testid={pickerTestid} onpick={(index) => draft.pick(draft.matches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.roomPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.roomFound?.query ?? ''} rooms={draft.roomMatches} active={draft.activeIndex} onpick={(index) => draft.pickRoom(draft.roomMatches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.emojiPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.emojiFound?.query ?? ''} emoji={draft.emojiMatches} active={draft.activeIndex} onpick={(index) => draft.pickEmoji(draft.emojiMatches[index])} onhover={(index) => draft.hover(index)} />
{/if}
<!-- spread: the field's own attributes (an `id`, a `data-testid`, its label and class, `onpaste`), which the caller decides -->
<ComposerEditable
	{...rest}
	{...draft.aria}
	{disabled}
	empty={draft.empty}
	bind:element={draft.element}
	onbeforeinput={draft.beforeinput}
	oninput={draft.input}
	oncompositionend={draft.compositionend}
	onkeydown={draft.keydown}
	onkeyup={draft.refreshQuery}
	onclick={draft.refreshQuery}
	onblur={draft.blur}
/>
