<script lang="ts">
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId } from '$lib/protocol/types';
	import { presence, presenceLabel } from '$lib/design/components/util';
	import { ownStatusLabel } from '$lib/ui/user-status';
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX, placePicker } from '$lib/ui/emoji';
	import { profileCard } from '$lib/ui/profile-card.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import Avatar from './Avatar.svelte';
	import RoleBadges from './RoleBadges.svelte';

	/**
	 * Who a mention, a sender or a member is: their avatar, name, `@user_id`
	 * (always, here: this is where people check who someone really is, §3.3),
	 * roles, and whether they're in the open room, with what you can do about
	 * them. Fixed to the viewport so the timeline never clips it: a popover
	 * beside what opened it on wide screens, a bottom sheet on narrow ones.
	 */

	interface Props {
		client: ChatClient | undefined;
		session: SessionView;
		/** The open pane's room: the thread when one is open. */
		room: RoomSnapshot | undefined;
		/** Adding members is offered here as in the member list (§4.3.2). */
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
	/** Their `status` (§4.11), when the server sends one: on the avatar and in words. An unknown one shows its value. */
	let status = $derived(directory.status(person));
	let shown = $derived(presence(status));
	let userId = $derived(person?.user_id ?? request?.userId ?? '');
	let name = $derived(directory.name(person));
	let me = $derived(directory.isMe(userId));
	let shares = $derived(person ? directory.sharesName(person) : false);
	let system = $derived(isSystemId(userId));
	/** Membership of the open room, when its listing is known; a large room may list only its recently active members (§4.3.1). */
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
	<div
		class="profile-card"
		class:sheet={placement.mode === 'sheet'}
		role="dialog"
		aria-label={`Profile of ${name}`}
		tabindex="-1"
		data-testid="profile-card"
		style:top={placement.mode === 'popover' ? `${placement.top}px` : undefined}
		style:left={placement.mode === 'popover' ? `${placement.left}px` : undefined}
		style:width={placement.mode === 'popover' ? `${WIDTH}px` : undefined}
		bind:this={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
	>
		<div class="who">
			<Avatar {name} id={userId} src={directory.avatar(person)} size="lg" {status} statusLabel={me ? ownStatusLabel(status) : undefined} />
			<div class="names">
				<div class="name-line">
					<span class="name">{name}</span>
					{#if me}<span class="you">(you)</span>{/if}
				</div>
				<div class="handle" data-testid="profile-handle">@{userId}</div>
				{#if shown === 'unknown'}
					<div class="presence" data-testid="profile-status">Unknown status: <code class="literal">{status}</code></div>
				{:else if shown}
					<div class="presence" data-testid="profile-status">{(me ? ownStatusLabel(status) : undefined) ?? presenceLabel(status)}</div>
				{/if}
				<RoleBadges user={person} />
			</div>
		</div>
		{#if shares}
			<p class="warn" role="note">Another user also shows as <strong>{name}</strong>. Check the @user_id.</p>
		{/if}
		{#if membership}<p class="muted" data-testid="profile-membership">{membership}</p>{/if}
		<div class="actions">
			{#if canMention && !system}<button class="ap-btn ap-btn-sm" type="button" onclick={mention}>Mention</button>{/if}
			<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" onclick={copy}>Copy @user_id</button>
			{#if canAdd}<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" disabled={busy} onclick={add}>{busy ? 'Adding…' : 'Add to room'}</button>{/if}
		</div>
		{#if note}<p class="muted" class:err={note.error} role={note.error ? 'alert' : 'status'}>{note.text}</p>{/if}
	</div>
{/if}

<style>
	/* A popover: raised ground, hairline, popover shadow, large radius. */
	.profile-card {
		position: fixed; z-index: 40; box-sizing: border-box; display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4);
		background: var(--bg-200); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-popover);
		font-family: var(--font-sans); color: var(--ink);
	}
	.profile-card:focus { outline: none; }
	/* Narrow screens: a bottom sheet, full width, rounded only where it meets the page. */
	.sheet { left: 0; right: 0; bottom: 0; border-bottom: 0; border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom)); }
	.who { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
	.names { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.name-line { display: flex; align-items: baseline; gap: var(--space-1); min-width: 0; }
	.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; line-height: 22px; font-weight: 600; }
	.you { flex: none; color: var(--ink-muted); font-size: 12px; }
	.handle { color: var(--ink-muted); font-size: 13px; line-height: 18px; overflow-wrap: anywhere; user-select: all; }
	.presence { color: var(--ink-muted); font-size: 12px; line-height: 16px; overflow-wrap: anywhere; }
	.presence .literal { font-family: var(--font-mono); font-size: 12px; color: var(--ink); }
	.names :global(.ap-roles) { align-self: flex-start; margin: 2px 0 0; }
	.muted, .warn { margin: 0; font-size: 13px; line-height: 18px; }
	.muted { color: var(--ink-muted); }
	.warn { padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--bg-300); color: var(--ink); }
	.err { color: var(--danger); }
	.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
