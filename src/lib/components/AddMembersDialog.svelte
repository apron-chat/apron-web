<script lang="ts">
	import AddMembersForm from '$lib/design/components/AddMembersForm.svelte';
	import type { PickPerson } from '$lib/design/components/types';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { faceOf } from '$lib/ui/faces';
	import { hueOf } from '$lib/ui/messages';
	import { messageOf, Task } from '$lib/ui/task.svelte';
	import { addMembers, couldNotAdd, isGuest, roleSets, userIdToAdd } from '$lib/ui/members';
	import { matching, pickable } from '$lib/ui/people';
	import type { SessionView } from '$lib/ui/session.svelte';

	/**
	 * The member list's +: adds the people picked to the open room or thread (`room_join` with each `user_id`, §4.2.2),
	 * in the design system's AddMembersForm, from the people the session knows who aren't members yet, or by a
	 * `@user_id` typed whole, or everyone with a role by `@role`. Guests aren't offered unless Hide guests is unticked: a
	 * guest's `user_id` may last only as long as their session, and a server may not let them be added at all, but which
	 * users are guests is a guess (`isGuest`). One the server refuses doesn't stop the rest, and stays picked, with why. Those added show in the timeline as their joins do.
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
	/** The most roles an `@` lists, above the people. */
	const ROLES_SHOWN = 5;

	// The caller mounts it each time, so the form starts empty.
	let open = $state(true);
	let query = $state('');
	/** Hide guests, at the start of the footer: on each time it opens. */
	let hideGuests = $state(true);
	let chosenIds = $state<string[]>([]);
	/** Adding them, and who wasn't added. */
	const task = new Task<'saving', string>();

	let memberIds = $derived(new Set((room.members ?? []).map((member) => member.user_id)));
	/** People the session knows who aren't members yet, but you and the system identities, by name. */
	let others = $derived(pickable(Object.values(session.snapshot.users).filter((user) => !memberIds.has(user.user_id))));
	/** Some of them look like guests: Hide guests is offered. */
	let guests = $derived(others.some(isGuest));
	/** Those offered: all of them, or, while Hide guests is ticked, all but the guests. */
	let candidates = $derived(hideGuests ? others.filter((user) => !isGuest(user)) : others);
	/**
	 * The roles an `@` names, each picking those of the candidates who hold it; then those whose name or `@user_id`
	 * holds what's typed; with none of either, the `@user_id` typed, as someone to add by it, since the client knows
	 * only some of the server's users.
	 */
	let people = $derived.by(() => {
		const roles: PickPerson[] = roleSets(candidates, query, ROLES_SHOWN).map(({ role, userIds }) => ({
			user_id: role, name: `@${role}`, group: userIds, detail: userIds.length === 1 ? '1 person with this role' : `${userIds.length} people with this role`
		}));
		const named = matching(candidates, query, PEOPLE_SHOWN);
		const shown: PickPerson[] = [...roles, ...named.map((user) => faceOf(user))];
		// `@&role` names a role, never someone to add by ID. A guest's ID typed whole is still offered: telling guests
		// apart is a guess (`isGuest`), and typing the exact ID is the way past a wrong one.
		const typed = /^@?&/.test(query.trim()) ? undefined : userIdToAdd(query);
		// With no one named so, nor a role named exactly that: a role it starts (`@ops` for `ops_team`) doesn't hide it.
		if (!named.length && typed && !roles.some((row) => row.user_id === typed) && !memberIds.has(typed) && !isSystemId(typed)) shown.push({ user_id: typed, name: typed, hue: hueOf(typed), detail: `Add by @user_id: @${typed}` });
		return shown;
	});
	let chosen = $derived(chosenIds.map((id) => faceOf(directory.person({ user_id: id }) ?? { user_id: id })));

	function pick(userId: string): void {
		task.note = undefined;
		chosenIds = chosenIds.includes(userId) ? chosenIds.filter((id) => id !== userId) : [...chosenIds, userId];
	}

	/** A role's people go in the chips, after those already there; once all of them are, they come out. */
	function pickGroup(userIds: string[]): void {
		task.note = undefined;
		const all = userIds.every((id) => chosenIds.includes(id));
		chosenIds = all ? chosenIds.filter((id) => !userIds.includes(id)) : [...chosenIds, ...userIds.filter((id) => !chosenIds.includes(id))];
	}

	async function add(): Promise<void> {
		if (task.busy || !chosenIds.length) return;
		const ids = [...chosenIds];
		const roomId = room.id;
		const name = (userId: string) => directory.name({ user_id: userId });
		let refused: Awaited<ReturnType<typeof addMembers>> = [];
		const worked = await task.run('saving', async () => {
			refused = await addMembers(client, roomId, ids);
			return refused;
		}, {
			done: (left) => (left.length ? couldNotAdd(left, name) : undefined),
			failed: (cause) => messageOf(cause, 'Unable to add them')
		});
		if (!worked) return;
		// Whoever wasn't added stays picked, to try again.
		chosenIds = refused.map(({ userId }) => userId);
		if (!refused.length) open = false;
	}
</script>

<AddMembersForm
	bind:open bind:query bind:hideGuests {guests} room={room.title} {people} {chosen} status={task.busy ? 'saving' : 'idle'} error={task.note} listTestid="add-people"
	onpick={pick} onpickgroup={pickGroup} onremove={pick} onsubmit={add} {onclose}
/>
