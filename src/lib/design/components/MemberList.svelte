<script lang="ts">
	import type { Snippet } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import Avatar from './Avatar.svelte';
	import RoleBadges from './RoleBadges.svelte';
	import type { MemberListPerson, MemberListSection } from './types';
	import { presence, presenceLabel } from './util';

	interface Props {
		/** Showing. Shut, it stays in the layout, hidden from everyone, so AppShell can slide it. */
		open?: boolean;
		/** The room's or thread's title, which each list's label names. */
		room?: string;
		/** How many members the room has, beside the heading (§4.2.1); more than are listed, a line says the list shows only the most recently active. */
		count?: number;
		/** The members, Online then Offline (§4.5). Omitted while there is no listing: `empty` says why. */
		sections?: MemberListSection[];
		/** In place of a listing: "Select a room to see its members.", "Loading members…". */
		empty?: string;
		/** Placeholder rows, while the app is still coming up. */
		placeholder?: boolean;
		/** The keys of folded sections. */
		shut?: string[];
		ontogglesection?: (key: string) => void;
		/** A row's name pressed: open their profile, from the row's button. */
		onprofile?: (userId: string, anchor: HTMLElement) => void;
		/** Offer removing members (`room_leave` with `user_id`, §4.2.2): a button on every row but yours, on hover. */
		onremove?: (userId: string) => void;
		/** Offer adding a member (`room_join` with `user_id`): a + after the count, which opens a form atop the list. */
		onaddtoggle?: () => void;
		addOpen?: boolean;
		/** The add form's field. `bind:adding` works. */
		adding?: string;
		/** People to suggest in the add form. */
		candidates?: { user_id: string; name: string }[];
		onadd?: (value: string) => void;
		/** Escape in the add form's field. */
		onaddcancel?: () => void;
		/** An add or remove is under way: they wait. */
		busy?: boolean;
		/** How the last change went: an error is announced at once. */
		note?: { text: string; error?: boolean };
		/** A standing line above the list, such as that the server doesn't let members change others. */
		remark?: string;
		/** Replaces each row's Avatar, such as with one tinted by the `user_id`. */
		avatar?: Snippet<[MemberListPerson]>;
		/** Replaces each row's RoleBadges. */
		roles?: Snippet<[MemberListPerson]>;
	}
	let {
		open = true, room, count, sections, empty, placeholder = false, shut = [], ontogglesection, onprofile, onremove,
		onaddtoggle, addOpen = false, adding = $bindable(''), candidates = [], onadd, onaddcancel, busy = false, note, remark, avatar, roles
	}: Props = $props();

	const uid = $props.id();
	const listed = $derived((sections ?? []).reduce((total, section) => total + section.people.length, 0));
	let addToggle = $state<HTMLButtonElement | undefined>();
	let addField = $state<HTMLInputElement | undefined>();

	/** Focus the add form's field, once it has opened. */
	export function focusAdd(): void {
		addField?.focus();
	}
	/** Focus the + that opens the add form, such as once it has shut. */
	export function focusAddToggle(): void {
		addToggle?.focus();
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		onadd?.(adding);
	}
</script>

<aside class={['ap-memberlist', open && 'ap-memberlist-open']} aria-label="Room member list">
	<div class="ap-memberlist-head">
		<span role="heading" aria-level="2">Members</span>
		{#if count !== undefined}<span class="ap-memberlist-count" data-testid="member-count">{count}</span>{/if}
		{#if onaddtoggle && sections}
			<button bind:this={addToggle} class={['ap-iconbtn', 'ap-memberlist-addtoggle', addOpen && 'ap-iconbtn-on']} type="button" aria-label="Add member" title="Add member" aria-expanded={addOpen} aria-controls={`${uid}-add`} onclick={onaddtoggle}><Plus size={16} aria-hidden="true" /></button>
		{/if}
	</div>
	<div class="ap-memberlist-body" data-testid="room-member-list">
		{#if placeholder}
			<div class="ap-memberlist-placeholder" aria-hidden="true"><span class="ap-skel" style:width="62%"></span><span class="ap-skel" style:width="48%"></span></div>
		{:else if !sections}
			{#if empty}<p class="ap-memberlist-note">{empty}</p>{/if}
		{:else}
			{#if onaddtoggle && addOpen}
				<!-- Raised, like a popover in place: the members stay in view below it. -->
				<form class="ap-memberlist-add" id={`${uid}-add`} onsubmit={submit} aria-label="Add a member">
					<label class="ap-sr" for={`${uid}-user`}>User to add</label>
					<div class="ap-memberlist-addrow">
						<input id={`${uid}-user`} bind:this={addField} class="ap-field" list="member-candidates" placeholder="@user_id" bind:value={adding} disabled={busy} autocomplete="off" spellcheck="false" onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onaddcancel?.(); } }} />
						<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={busy || !adding.trim()}>Add</button>
					</div>
					<datalist id="member-candidates">
						{#each candidates as user (user.user_id)}<option value={user.user_id}>{user.name} (@{user.user_id})</option>{/each}
					</datalist>
				</form>
			{/if}
			{#if note}<p class={['ap-memberlist-note', note.error && 'ap-tone-danger']} role={note.error ? 'alert' : 'status'}>{note.text}</p>{/if}
			{#if remark}<p class="ap-memberlist-note">{remark}</p>{/if}
			{#if listed === 0}
				<p class="ap-memberlist-note">No members listed.</p>
			{:else}
				{#if count !== undefined && count > listed}<p class="ap-memberlist-note" data-testid="member-list-truncated">Showing {listed} of {count}: the most recently active</p>{/if}
				{#each sections as section (section.key)}
					{@const sectionOpen = section.key === 'members' || !shut.includes(section.key)}
					<section class="ap-memberlist-section" data-section={section.key}>
						<!-- Without presence, one list under the panel's own header and count: a Members heading would repeat them. -->
						{#if section.key !== 'members'}
							<h3 class="ap-memberlist-sectionhead">
								<button class={['ap-sect-toggle', !sectionOpen && 'ap-memberlist-shut']} type="button" aria-expanded={sectionOpen} onclick={() => ontogglesection?.(section.key)}><span class="ap-sect-caret" aria-hidden="true">▾</span>{section.label}<span class="ap-memberlist-sectioncount">· {section.people.length}</span></button>
							</h3>
						{/if}
						{#if sectionOpen}
							<ul class="ap-memberlist-people" aria-label={room ? `${section.label} in ${room}` : section.label}>
								{#each section.people as person (person.user_id)}
									{@const name = person.name || person.user_id}
									{@const shown = presence(person.status)}
									{@const words = person.statusLabel ?? presenceLabel(person.status)}
									<li class={['ap-member', (shown === 'offline' || shown === 'invisible') && 'ap-member-offline']} data-user={person.user_id} data-status={shown}>
										<button class="ap-member-who" type="button" data-user-id={person.user_id} aria-haspopup="dialog" title={words ? `@${person.user_id} · ${words}` : `@${person.user_id}`} onclick={(event) => onprofile?.(person.user_id, event.currentTarget)}>
											{#if avatar}{@render avatar(person)}{:else}<Avatar {name} user_id={person.user_id} src={person.avatar} size="sm" status={person.status} statusLabel={words} />{/if}
											<span class="ap-member-name">
												<bdi>{name}</bdi>{#if person.handle}<small>@{person.user_id}</small>{/if}{#if person.you}<small>(you)</small>{/if}{#if words}<span class="ap-sr">, {words.toLowerCase()}</span>{/if}
											</span>
										</button>
										{#if roles}{@render roles(person)}{:else}<RoleBadges roles={person.roles} />{/if}
										{#if onremove && !person.you}
											<button class="ap-iconbtn ap-member-remove" type="button" aria-label={`Remove ${name}`} title="Remove from room" disabled={busy} onclick={() => onremove?.(person.user_id)}><UserMinus size={14} aria-hidden="true" /></button>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			{/if}
		{/if}
	</div>
</aside>
