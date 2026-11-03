<script lang="ts">
	import { keepsBio, type ChatClient, type RoomSnapshot } from '$lib/protocol/client';
	import { renderBio } from '$lib/protocol/markdown';
	import { isSystemId } from '$lib/protocol/types';
	import { lastSeen, ownStatusLabel } from '$lib/ui/user-status';
	import { minuteNow } from '$lib/ui/clock.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { placePicker } from '$lib/ui/emoji';
	import { profileCard } from '$lib/ui/profile-card.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import ProfileCard from '$lib/design/components/ProfileCard.svelte';
	import Avatar from '$lib/design/components/Avatar.svelte';
	import { hueOf } from '$lib/ui/messages';
	import { messageThem, START_FAILED } from '$lib/ui/private-rooms';
	import { failure, Task } from '$lib/ui/task.svelte';

	/**
	 * Who a mention, a sender or a member is: the design system's ProfileCard,
	 * filled from the directory (their avatar, name, `@user_id`, status, roles,
	 * bio, and whether they're in the open room), with what you can do about them.
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
		/** Message is offered: signed in to an account (not a guest) that may create rooms (capability `rooms`). */
		canMessage?: boolean;
		onmention: (userId: string) => void;
		/** The server named the room Message is starting, before it opens: one you started, not one someone added you to. */
		onnamed?: (roomId: string) => void;
		/** Opens a private room: the conversation you already have with them, or the one Message just started. */
		onopenroom?: (roomId: string) => void;
	}
	let { client, session, room, canChange, canMention, canMessage = false, onmention, onnamed, onopenroom }: Props = $props();

	const WIDTH = 320;

	let box = $state<HTMLDivElement | undefined>();
	let measured = $state(0);
	/** Bumped on scroll and resize, so the popover follows what opened it. */
	let reflowed = $state(0);
	/** Adding them to the room, or opening a conversation with them, and what came of it: this card's, until another opens. */
	const task = new Task<'add' | 'message' | 'copy'>();

	let request = $derived(profileCard.current);
	let placement = $derived.by(() => {
		void reflowed;
		if (!request) return undefined;
		return placePicker(request.anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, { width: WIDTH, height: measured || 200, rtl: getComputedStyle(request.anchor).direction === 'rtl' });
	});

	let person = $derived(request ? directory.person({ user_id: request.userId }) : undefined);
	/** Their `status` (§4.5), when the server sends one: on the avatar and in words. An unknown one shows its value. */
	let status = $derived(directory.status(person));
	let userId = $derived(person?.user_id ?? request?.userId ?? '');
	let name = $derived(directory.name(person));
	let me = $derived(directory.isMe(userId));
	/** When they were last seen (§4.5.2), while they show offline: never yours. Redone each minute, so `recently` and `15m ago` move on. */
	let seen = $derived.by(() => {
		const id = directory.seen(person);
		return id === undefined ? undefined : lastSeen(id, minuteNow());
	});
	let shares = $derived(person ? directory.sharesName(person) : false);
	let system = $derived(isSystemId(userId));
	/** `roles` (§3.3) from the kept user object, else the recorded one: badges under the name, never part of it. */
	let roles = $derived(Array.isArray(person?.roles) ? person.roles : undefined);
	/** Their bio (`ext:bio`), from a server that keeps one: its `http(s)` links linked, opening in a new tab. */
	let bio = $derived(keepsBio(session.server) ? directory.bio(person) : undefined);
	let bioHtml = $derived(bio ? renderBio(bio) : '');
	/** Membership of the open room, when its listing is known; a large room may list only its recently active members (§4.2.1). */
	let listed = $derived(request?.member || room?.members?.some((member) => directory.person(member)?.user_id === userId));
	let partial = $derived(room?.members !== undefined && (room.memberCount ?? 0) > room.members.length);
	let membership = $derived.by(() => {
		if (!room) return undefined;
		if (listed) return `Member of ${room.title}`;
		if (room.members === undefined) return undefined;
		return partial ? `Not among the recently active members of ${room.title}` : `Not in ${room.title}`;
	});
	let canAdd = $derived(
		canChange && !session.snapshot.memberChangesUnsupported && Boolean(client) && Boolean(room?.joined) && room?.members !== undefined && !listed && !me && !system
	);

	/** Message: for someone else, not a system identity, on a session that may start private rooms. */
	let canMessageThem = $derived(canMessage && Boolean(client) && Boolean(onopenroom) && !me && !system);

	// A new card starts without the last one's note, and free: what the last one started notes nothing here.
	$effect(() => {
		void request;
		task.reset();
	});

	// Focus moves in when it opens, so Escape and Tab work from the keyboard.
	$effect(() => {
		if (request && box) box.focus({ preventScroll: true });
	});

	// While open: follow what opened it, and close on a press outside.
	$effect(() => {
		const current = request;
		if (!current) return;
		// A row that presses its name (`data-presses-anchor`, a member's) counts as the name: its click toggles the card
		// closed, so a press on it mustn't close it first, for that click to open it again.
		const trigger = current.anchor.closest<HTMLElement>('[data-presses-anchor]') ?? current.anchor;
		const outside = (event: PointerEvent) => {
			const path = event.composedPath();
			if ((box && path.includes(box)) || path.includes(trigger)) return;
			// The sheet's dimmed page closes it on its own click, so the press reaches nothing under it.
			if (path.some((target) => target instanceof Element && target.classList.contains('ap-popover-scrim'))) return;
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
		const id = userId;
		await task.run('copy', () => navigator.clipboard.writeText(`@${id}`), {
			done: () => ({ text: `Copied @${id}`, error: false }),
			failed: () => ({ text: 'Unable to copy', error: true })
		});
	}

	/**
	 * Opens the private conversation you already have with them, else starts one (`messageUser`), and opens it. Progress
	 * and errors show in the card's note; one that started but couldn't add them is kept, and the note says so.
	 */
	async function message(): Promise<void> {
		if (!client || !onopenroom) return;
		const chat = client;
		const open = onopenroom;
		const id = userId;
		await task.run('message', (still) => messageThem(chat, session.rooms, session.you?.user_id, id, {
			named: onnamed,
			name: (failed) => directory.name({ user_id: failed }),
			// Started at the reader's asking: it opens, wherever they are now.
			open: (roomId) => {
				if (still()) profileCard.close();
				open(roomId);
			}
		}), {
			done: (kept) => (kept ? { text: kept, error: true } : undefined),
			failed: failure(START_FAILED)
		});
	}

	async function add(): Promise<void> {
		if (!client || !room) return;
		const chat = client;
		const target = room;
		const id = userId;
		await task.run('add', () => chat.joinRoom(target.id, id).promise, {
			done: () => ({ text: `Added to ${target.title}`, error: false }),
			failed: failure('Unable to add them')
		});
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
		{seen}
		{roles}
		{bio}
		sharesName={shares}
		{membership}
		onmessage={canMessageThem ? message : undefined}
		messaging={task.running === 'message'}
		onmention={canMention && !system ? mention : undefined}
		oncopyid={copy}
		onaddtoroom={canAdd ? add : undefined}
		adding={task.running === 'add'}
		note={task.note}
		testid="profile-card"
		statusTestid="profile-status"
		seenTestid="profile-seen"
		rolesTestid="roles"
		bioTestid="profile-bio"
		bind:element={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
		onclose={() => profileCard.close()}
	>
		{#snippet bioBody()}{@html bioHtml}{/snippet}
		{#snippet avatar()}<Avatar {name} hue={hueOf(userId)} src={directory.avatar(person)} size="lg" {status} statusLabel={me ? ownStatusLabel(status) : undefined} />{/snippet}
	</ProfileCard>
{/if}
