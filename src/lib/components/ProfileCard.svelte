<script lang="ts">
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId } from '$lib/protocol/types';
	import { ownStatusLabel } from '$lib/ui/user-status';
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { placePicker } from '$lib/ui/emoji';
	import { profileCard } from '$lib/ui/profile-card.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import ProfileCard from '$lib/design/components/ProfileCard.svelte';
	import Avatar from './Avatar.svelte';

	/**
	 * Who a mention, a sender or a member is: the design system's ProfileCard,
	 * filled from the directory (their avatar, name, `@user_id`, status, roles,
	 * and whether they're in the open room), with what you can do about them.
	 * Fixed to the viewport so the timeline never clips it: placed beside what
	 * opened it on wide screens, a bottom sheet on narrow ones.
	 */

	interface Props {
		client: ChatClient | undefined;
		session: SessionView;
		/** The open pane's room: the thread when one is open. */
		room: RoomSnapshot | undefined;
		/** Adding members is offered here as in the member list (§4.2.2). */
		canChange: boolean;
		/** Mention is offered while the composer takes text. */
		canMention: boolean;
		onmention: (userId: string) => void;
	}
	let { client, session, room, canChange, canMention, onmention }: Props = $props();

	const WIDTH = 288;

	let box = $state<HTMLDivElement | undefined>();
	let measured = $state(0);
	/** Bumped on scroll and resize, so the popover follows what opened it. */
	let reflowed = $state(0);
	let busy = $state(false);
	let note = $state<{ text: string; error: boolean } | undefined>();

	let request = $derived(profileCard.current);
	let placement = $derived.by(() => {
		void reflowed;
		if (!request) return undefined;
		return placePicker(request.anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, { width: WIDTH, height: measured || 200 });
	});

	let person = $derived(request ? directory.person({ user_id: request.userId }) : undefined);
	/** Their `status` (§4.5), when the server sends one: on the avatar and in words. An unknown one shows its value. */
	let status = $derived(directory.status(person));
	let userId = $derived(person?.user_id ?? request?.userId ?? '');
	let name = $derived(directory.name(person));
	let me = $derived(directory.isMe(userId));
	let shares = $derived(person ? directory.sharesName(person) : false);
	let system = $derived(isSystemId(userId));
	/** `roles` (§3.3) from the kept user object, else the recorded one: badges under the name, never part of it. */
	let roles = $derived(Array.isArray(person?.roles) ? person.roles : undefined);
	/** Membership of the open room, when its listing is known; a large room may list only its recently active members (§4.2.1). */
	let listed = $derived(room?.members?.some((member) => directory.person(member)?.user_id === userId));
	let partial = $derived(room?.members !== undefined && (room.memberCount ?? 0) > room.members.length);
	let membership = $derived.by(() => {
		if (!room || room.members === undefined) return undefined;
		if (listed) return `Member of ${room.title}`;
		return partial ? `Not among the recently active members of ${room.title}` : `Not in ${room.title}`;
	});
	let canAdd = $derived(
		canChange && !session.snapshot.memberChangesUnsupported && Boolean(client) && Boolean(room?.joined) && room?.members !== undefined && !listed && !me && !system
	);

	// A new card starts without the last one's note.
	$effect(() => {
		void request;
		note = undefined;
		busy = false;
	});

	// Focus moves in when it opens, so Escape and Tab work from the keyboard.
	$effect(() => {
		if (request && box) box.focus({ preventScroll: true });
	});

	// While open: follow what opened it, and close on a press outside.
	$effect(() => {
		const current = request;
		if (!current) return;
		const outside = (event: PointerEvent) => {
			const path = event.composedPath();
			if ((box && path.includes(box)) || path.includes(current.anchor)) return;
			profileCard.close();
		};
		const reflow = () => {
			if (!current.anchor.isConnected || (innerWidth < NARROW_MAX) !== (placement?.mode === 'sheet')) {
				profileCard.close();
				return;
			}
			reflowed++;
		};
		document.addEventListener('pointerdown', outside, true);
		addEventListener('resize', reflow);
		addEventListener('scroll', reflow, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			removeEventListener('resize', reflow);
			removeEventListener('scroll', reflow, true);
		};
	});

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		profileCard.close(true);
	}

	/** Tabbing out of the card closes it, as a press outside does. */
	function focusout(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !box || box.contains(next) || request?.anchor.contains(next)) return;
		profileCard.close();
	}

	function mention(): void {
		// Closing the card clears who it shows, so take the ID first.
		const id = userId;
		profileCard.close();
		onmention(id);
	}

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(`@${userId}`);
			note = { text: `Copied @${userId}`, error: false };
		} catch {
			note = { text: 'Unable to copy', error: true };
		}
	}

	async function add(): Promise<void> {
		if (!client || !room || busy) return;
		const target = room;
		busy = true;
		note = undefined;
		try {
			await client.joinRoom(target.id, userId).promise;
			note = { text: `Added to ${target.title}`, error: false };
		} catch (cause) {
			note = { text: cause instanceof Error ? cause.message : 'Unable to add them', error: true };
		} finally {
			busy = false;
		}
	}
</script>

{#if request && placement}
	<ProfileCard
		mode={placement.mode}
		top={placement.mode === 'popover' ? placement.top : undefined}
		left={placement.mode === 'popover' ? placement.left : undefined}
		width={placement.mode === 'popover' ? WIDTH : undefined}
		{userId}
		{name}
		you={me}
		{status}
		statusLabel={me ? ownStatusLabel(status) : undefined}
		{roles}
		sharesName={shares}
		{membership}
		onmention={canMention && !system ? mention : undefined}
		oncopyid={copy}
		onaddtoroom={canAdd ? add : undefined}
		adding={busy}
		{note}
		data-testid="profile-card"
		statusTestid="profile-status"
		rolesTestid="roles"
		bind:element={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
	>
		{#snippet avatar()}<Avatar {name} id={userId} src={directory.avatar(person)} size="lg" {status} statusLabel={me ? ownStatusLabel(status) : undefined} />{/snippet}
	</ProfileCard>
{/if}
