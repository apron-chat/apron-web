<script module lang="ts">
	import type { MentionPerson } from '$lib/protocol/markdown';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';

	/** Who and what a description's `@` and `#` can name, as in the composer: what each form with one takes. */
	export interface DescriptionSources {
		people?: MentionPerson[];
		rooms?: RoomSuggestion[];
		/** The mention picker opened: a moment to refresh who can be named. */
		onmention?: () => void;
	}
</script>

<script lang="ts">
	import MarkdownEditor from '$lib/design/components/MarkdownEditor.svelte';
	import type { MarkdownEditorField, RoomFormField } from '$lib/design/components/types';
	import DraftPreview from './DraftPreview.svelte';
	import FormatToolbar from './FormatToolbar.svelte';
	import MessageField from './MessageField.svelte';

	/**
	 * A room's or thread's description being written, in its RoomForm (`field`): written as in the composer, with
	 * mentions as chips, the same autocomplete and lists that carry on (`MessageField`), the full panel's formatting
	 * buttons, and Preview, drawn as the description will be. Enter starts a line; Ctrl+Enter (⌘+Enter) submits the form.
	 * Leaving the field (for Save, Preview or the title) finishes it, as sending does a message: a name typed out in full
	 * after `@` at its end becomes its mention.
	 * A description has no list of who it mentions, so its chips are only how its `@user_id`s show: no one is notified.
	 */
	interface Props extends DescriptionSources {
		/** The description, Markdown; `bind:value`. */
		value: string;
		/** What its RoomForm draws it with: its name, placeholder, height, and how Ctrl+Enter submits. */
		form: RoomFormField;
	}
	let { value = $bindable(), people = [], rooms = [], onmention, form }: Props = $props();

	let field = $state<MessageField | undefined>();
</script>

<MarkdownEditor label={form.label} placeholder={form.placeholder} disabled={form.disabled} rows={form.rows} field={editable} toolbar={formatting} rendered={preview} onpreview={(on) => { if (!on) field?.focus(); }} testid="description-editor" />

{#snippet editable({ class: className, label, placeholder, disabled }: MarkdownEditorField)}
	<MessageField bind:this={field} bind:value {people} {rooms} {placeholder} {disabled} newlineOnEnter class={className} aria-label={label} data-testid="description-input" pickerTestid="description-picker" onsubmit={() => { field?.finish(); form.submit(); }} onfocusout={() => field?.finish()} {onmention} />
{/snippet}
{#snippet formatting()}<FormatToolbar apply={(change) => field?.apply(change) ?? false} disabled={form.disabled} />{/snippet}
{#snippet preview()}<DraftPreview text={value} />{/snippet}
