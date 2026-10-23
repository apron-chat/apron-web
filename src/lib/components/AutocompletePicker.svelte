<script lang="ts">
	import MentionPicker from '$lib/design/components/MentionPicker.svelte';
	import type { MentionPerson } from '$lib/protocol/markdown';
	import type { EmojiSuggestion } from '$lib/ui/emoji-autocomplete';
	import type { RoomSuggestion } from '$lib/ui/room-autocomplete';
	import type { HTMLAttributes } from 'svelte/elements';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';

	/**
	 * The composer's autocomplete (the design system's `MentionPicker`): the
	 * people an `@` can name, the rooms a `#` can, or the emoji a `:shortcode`
	 * can put in, whichever is given, each person's face tinted by their ID.
	 * Other attributes (`data-testid`) go on the list.
	 */
	interface Props extends HTMLAttributes<HTMLElement> {
		/** The list's ID, which the field names in `aria-controls`; option `i` is `${id}-${i}`, its `aria-activedescendant`. */
		id: string;
		/** What has been typed after the `@`, `#` or `:`. */
		query: string;
		people?: MentionPerson[];
		rooms?: RoomSuggestion[];
		emoji?: EmojiSuggestion[];
		active: number;
		/** A pick, by its index in the list. */
		onpick: (index: number) => void;
		onhover: (index: number) => void;
	}
	let { id, query, people, rooms, emoji, active, onpick, onhover, ...rest }: Props = $props();

	let senders = $derived(people?.map((person) => ({ user_id: person.id, name: person.name, avatar: person.avatar })));
</script>

{#snippet face(person: { user_id: string; name?: string; avatar?: string })}
	<Avatar name={person.name?.trim() || person.user_id} hue={hueOf(person.user_id)} src={person.avatar} size="sm" />
{/snippet}

<MentionPicker {id} {query} people={senders} {rooms} {emoji} {active} avatar={face} {...rest} onpick={(_, index) => onpick(index)} {onhover} />
