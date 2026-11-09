<script lang="ts">
	import MarkdownEditor from '$lib/design/components/MarkdownEditor.svelte';
	import type { MarkdownEditorField, RoomFormField } from '$lib/design/components/types';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import type { TextEdit } from '$lib/ui/text-edit';
	import DraftPreview from './DraftPreview.svelte';
	import FormatToolbar from './FormatToolbar.svelte';
	import MessageField from './MessageField.svelte';

	/**
	 * A room's or thread's description being written, in its RoomForm (`field`): written as in the composer, with
	 * mentions as chips, the same autocomplete and lists that carry on (`MessageField`), the full panel's formatting
	 * buttons, and Preview, drawn as the description will be. Enter starts a line; Ctrl+Enter (⌘+Enter) submits the form.
	 * A description has no list of who it mentions, so its chips are only how its `@user_id`s show: no one is notified.
	 */
	interface Props extends RoomFormField {
		/** The description, Markdown; `bind:value`. */
		value: string;
		/** Who an `@` can name. */
		people?: MentionPerson[];
		/** Rooms and threads a `#` can name. */
		rooms?: RoomSuggestion[];
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
	}
	let { value = $bindable(), people = [], rooms = [], onmention, label, placeholder, disabled, rows, submit }: Props = $props();

	let field = $state<MessageField | undefined>();
	/** Who its chips name, which a description doesn't send: kept only because the field reports it. */
	let mentions = $state<string[]>([]);

	function apply(change: (edit: TextEdit) => TextEdit | undefined): boolean {
		return field?.apply(change) ?? false;
	}
</script>

<MarkdownEditor {value} {label} {placeholder} {disabled} {rows} field={editable} toolbar={formatting} rendered={preview} onpreview={(on) => { if (!on) field?.focus(); }} testid="description-editor" />

{#snippet editable({ class: className, label, placeholder, disabled }: MarkdownEditorField)}
	<MessageField bind:this={field} bind:value bind:mentions {people} {rooms} {placeholder} {disabled} newlineOnEnter class={className} aria-label={label} data-testid="description-input" pickerTestid="description-picker" onsubmit={submit} {onmention} />
{/snippet}
{#snippet formatting()}<FormatToolbar {apply} {disabled} />{/snippet}
{#snippet preview()}<DraftPreview text={value} links={false} />{/snippet}
