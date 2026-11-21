<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type { DraftFacts } from '$lib/design/components/compose';
	import ComposerEditable from '$lib/design/components/ComposerEditable.svelte';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import { DraftField } from '$lib/ui/draft-field.svelte';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import type { CommandOffer } from '$lib/ui/command-query';
	import type { TextEdit } from '$lib/ui/text-edit';
	import { autocompletePicker, commandCard } from './lazy';

	/**
	 * Where a message is written, in the composer and in the message editor
	 * alike: the design system's `ComposerEditable` with mentions as chips
	 * (`@user_id` in the text, Appendix A.3), and the autocomplete for `@`
	 * people, `#` rooms, `:` emoji and, given `commands`, `/` commands, its picker anchored to the nearest
	 * positioned box around the field (`DraftField` does the work).
	 */
	interface Props extends Omit<ComponentProps<typeof ComposerEditable>, 'element' | 'empty' | 'onbeforeinput' | 'oninput' | 'oncompositionend' | 'onkeydown' | 'onkeyup' | 'onclick' | 'onblur'> {
		/** The draft as sent; `bind:value`. Set from outside, its `@user_id`s show as chips. */
		value: string;
		/** The `user_id`s its chips mention, for `body.mentions` (§3.5); `bind:mentions`. */
		mentions?: string[];
		/** Who an `@` can name. */
		people: MentionPerson[];
		/** Who else an `@` can name though they aren't here, offered after `people`, faded, once something is typed. */
		outsiders?: MentionPerson[];
		/** The mentions that won't reach anyone as it would go (a `user_id`, or `&role`): their chips are greyed. */
		quiet?: ReadonlySet<string>;
		/** Rooms and threads a `#` can name. */
		rooms?: RoomSuggestion[];
		/** More `user_id`s that are people, such as those a message being edited mentions: an `@` of one is a chip. */
		known?: string[];
		/** Enter where it sends or saves (`enterAction`), with no picker taking it. */
		onsubmit: () => void;
		/** Enter starts a new line and Ctrl+Enter (⌘+Enter) sends, for writing at length: the composer's full panel. */
		newlineOnEnter?: boolean;
		/** A key no picker took, before Enter's, such as ↑ in an empty composer: true when it was taken. */
		onkey?: (event: KeyboardEvent) => boolean;
		/** The draft changed by typing or a pick, not set from outside. */
		oninput?: () => void;
		/** The draft was emptied from outside, as sending it does (`DraftHost.oncleared`). */
		oncleared?: () => void;
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
		/** What someone the picker offers who isn't here reads beside their name: "Not in room". */
		outsideLabel?: string;
		/** A `data-testid` for the people's picker. */
		pickerTestid?: string;
		/** The commands a `/` at the start can name (`ext:command_list`): set where they are offered, the composer. */
		commands?: CommandOffer;
	}
	let { value = $bindable(), mentions = $bindable([]), people, outsiders, quiet, rooms = [], known, disabled = false, onsubmit, newlineOnEnter = false, onkey, oninput, oncleared, onmention, outsideLabel, pickerTestid, commands, ...rest }: Props = $props();

	/** Unique per field, for its picker's ID. */
	const uid = $props.id();
	const draft = new DraftField({
		get value() { return value; },
		set value(text) { value = text; },
		get mentions() { return mentions; },
		set mentions(ids) { mentions = ids; },
		get people() { return people; },
		get outsiders() { return outsiders; },
		get quiet() { return quiet; },
		get rooms() { return rooms; },
		get known() { return known; },
		// Set only where commands are offered: the message editor's field has none.
		get commands() { return commands; },
		get disabled() { return disabled; },
		get newlineOnEnter() { return newlineOnEnter; },
		submit: () => onsubmit(),
		key: (event) => onkey?.(event) ?? false,
		oninput: () => oninput?.(),
		oncleared: () => oncleared?.(),
		onmention: () => onmention?.(),
		// Read once a picker would open, which is what asks for its code (`autocompletePicker`): until it has come, none shows.
		get pickerShown() { return autocompletePicker.component !== undefined; }
	}, `${uid}-suggestions`);

	/** Focuses the field, the caret at the end unless it is in there already (or, with `end`, wherever it is). */
	export function focus(end = false): void {
		draft.focus(end);
	}

	// The chips of mentions that won't reach anyone are greyed, as that changes: new chips are drawn greyed or not.
	$effect(() => {
		if (quiet) draft.markQuiet(quiet);
	});

	/** Puts a mention chip for this user where the caret was (else at the end), as picking them would, and focuses the field. */
	export function mention(userId: string): void {
		draft.mention(userId);
	}

	/** Puts text (a picked emoji) where the caret was, over any selection. */
	export function insert(text: string): void {
		draft.insert(text);
	}

	/** What the composer asks of the draft (`DraftField.facts`): reactive, and replaced only as one of them changes. */
	export function facts(): DraftFacts {
		return draft.facts;
	}

	/** Puts `/name ` at the draft's start, in place of the command text there (`DraftField.putCommand`), focused. */
	export function putCommand(name: string): void {
		draft.putCommand(name);
	}

	/** Makes a formatting change to the draft and its selection, as typing it would (`DraftField.apply`). */
	export function apply(change: (edit: TextEdit) => TextEdit | undefined): boolean {
		return draft.apply(change);
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

<!-- Loaded on demand: the first picker opened before the on-demand chunk's prefetch waits on its request. -->
{#if (draft.pickerOpen || draft.roomPickerOpen || draft.emojiPickerOpen || draft.commandPickerOpen || draft.commandInfo) && autocompletePicker.component}
{@const AutocompletePicker = autocompletePicker.component}
{#if draft.pickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.query ?? ''} people={draft.matches} active={draft.activeIndex} testid={pickerTestid} outside={outsideLabel} onpick={(index) => draft.pick(draft.matches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.roomPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.roomFound?.query ?? ''} rooms={draft.roomMatches} active={draft.activeIndex} onpick={(index) => draft.pickRoom(draft.roomMatches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.emojiPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.emojiFound?.query ?? ''} emoji={draft.emojiMatches} active={draft.activeIndex} onpick={(index) => draft.pickEmoji(draft.emojiMatches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.commandPickerOpen}
	<AutocompletePicker id={draft.pickerId} query={draft.commandFound?.typed ?? ''} commands={draft.commandMatches} active={draft.activeIndex} onpick={(index) => draft.pickCommand(draft.commandMatches[index])} onhover={(index) => draft.hover(index)} />
{:else if draft.commandInfo && !disabled && commandCard.component}
	<!-- A command's arguments typed: its entry alone, to inform; the field keeps its keys. -->
	{@const CommandCard = commandCard.component}
	<CommandCard command={draft.commandInfo} testid="command-card" />
{/if}
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
	onkeyup={draft.keyup}
	onclick={draft.click}
	onblur={draft.blur}
/>
