<script lang="ts">
	import AddMembersForm from '$lib/design/components/AddMembersForm.svelte';
	import type { PickPerson } from '$lib/design/components/types';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { faceOf } from '$lib/ui/faces';
	import { hueOf } from '$lib/ui/messages';
	import { addMembers, couldNotAdd, userIdToAdd } from '$lib/ui/members';
	import { matching, pickable } from '$lib/ui/people';
	import type { SessionView } from '$lib/ui/session.svelte';

	/**
	 * The member list's +: adds the people picked to the open room or thread (`room_join` with each `user_id`, §4.2.2),
	 * in the design system's AddMembersForm, from the people the session knows who aren't members yet, or by a
	 * `@user_id` typed whole. One the server refuses doesn't stop the rest, and stays picked, with why. Those added
	 * show in the timeline as their joins do.
	 */
	interface Props {
		client: ChatClient;
		session: SessionView;
		room: RoomSnapshot;
		/** It closed: done, or put away. */
		onclose: () => void;
	}
	let { client, session, room, onclose }: Props = $props();

	/** The most people listed at once: typing narrows it. */
	const PEOPLE_SHOWN = 50;

	// The caller mounts it each time, so the form starts empty.
	let open = $state(true);
	let query = $state('');
	let chosenIds = $state<string[]>([]);
	let saving = $state(false);
	let error = $state<string | undefined>();

	let memberIds = $derived(new Set((room.members ?? []).map((member) => member.user_id)));
	/** People the session knows who aren't members yet, but you and the system identities, by name. */
	let candidates = $derived(pickable(Object.values(session.snapshot.users).filter((user) => !memberIds.has(user.user_id))));
	/**
	 * Those whose name or `@user_id` holds what's typed; with none, the `@user_id` typed, as someone to add by it, since
	 * the client knows only some of the server's users.
	 */
	let people = $derived.by(() => {
		const shown: PickPerson[] = matching(candidates, query, PEOPLE_SHOWN).map((user) => faceOf(user));
		const typed = userIdToAdd(query);
		if (!shown.length && typed && !memberIds.has(typed) && !isSystemId(typed)) shown.push({ user_id: typed, name: typed, hue: hueOf(typed), detail: `Add by @user_id: @${typed}` });
		return shown;
	});
	let chosen = $derived(chosenIds.map((id) => faceOf(directory.person({ user_id: id }) ?? { user_id: id })));

	function pick(userId: string): void {
		error = undefined;
		chosenIds = chosenIds.includes(userId) ? chosenIds.filter((id) => id !== userId) : [...chosenIds, userId];
	}

	async function add(): Promise<void> {
		if (saving || !chosenIds.length) return;
		const ids = [...chosenIds];
		const roomId = room.id;
		saving = true;
		error = undefined;
		const refused = await addMembers(client, roomId, ids);
		saving = false;
		const name = (userId: string) => directory.name({ user_id: userId });
		chosenIds = refused.map(({ userId }) => userId);
		if (refused.length) error = couldNotAdd(refused, name);
		else open = false;
	}
</script>

<AddMembersForm
	bind:open bind:query room={room.title} {people} {chosen} status={saving ? 'saving' : 'idle'} {error} listTestid="add-people"
	onpick={pick} onremove={pick} onsubmit={add} {onclose}
/>
