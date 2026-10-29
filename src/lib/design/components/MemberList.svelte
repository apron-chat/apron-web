<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Plus from '@lucide/svelte/icons/plus';
	import Avatar from './Avatar.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import FoldHeading from './FoldHeading.svelte';
	import { hold } from './hold';
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
		/** The keys of folded sections: each a FoldHeading, folded to no one (presence isn't news). */
		shut?: string[];
		ontogglesection?: (key: string) => void;
		/** A row's name pressed: open their profile, from the row's button. */
		onprofile?: (userId: string, anchor: HTMLElement) => void;
		/**
		 * Offer removing members (`room_leave` with `user_id`, §4.2.2): Remove from room, in a menu on every row but yours,
		 * opened by a right-click, the context menu key, or a long press.
		 */
		onremove?: (userId: string) => void;
		/** Offer adding people (`room_join` with `user_id`): a + after the count, which opens an <AddMembersForm>. */
		onadd?: () => void;
		/** A remove is under way: the rows' menus wait. */
		busy?: boolean;
		/** How the last change went: an error is announced at once. */
		note?: { text: string; error?: boolean };
		/** A standing line above the list, such as that the server doesn't let members change others. */
		remark?: string;
		/** Replaces each row's Avatar, such as with one tinted by the `user_id`. */
		avatar?: Snippet<[MemberListPerson]>;
		/** Replaces each row's RoleBadges. */
		roles?: Snippet<[MemberListPerson]>;
		/** `data-testid`s for the count beside the heading, the body, and the line saying the list is a part of the room. */
		countTestid?: string;
		bodyTestid?: string;
		truncatedTestid?: string;
		/** Classes for its `<aside>`, added to its own. */
		class?: ClassValue;
	}
	let {
		open = true, room, count, sections, empty, placeholder = false, shut = [], ontogglesection, onprofile, onremove,
		onadd, busy = false, note, remark, avatar, roles, countTestid, bodyTestid, truncatedTestid, class: className
	}: Props = $props();

	const listed = $derived((sections ?? []).reduce((total, section) => total + section.people.length, 0));

	/** The row whose menu is open, and where. */
	let menu = $state<{ person: MemberListPerson; name: string; x: number; y: number; keyboard?: true; row: HTMLElement } | undefined>();
	let menuOpen = $state(false);

	/** A row's menu, where there's something in it: never yours, nor while a remove is under way (the browser's own menu, then). */
	function rowMenu(person: MemberListPerson, name: string) {
		return hold((at, row) => {
			if (!onremove || person.you || busy) return false;
			menu = { person, name, ...at, row: row.querySelector<HTMLElement>('.ap-member-who') ?? row };
			menuOpen = true;
		});
	}
</script>

<aside aria-label="Room member list" class={['ap-memberlist', open && 'ap-memberlist-open', className]}>
	<div class="ap-memberlist-head">
		<span role="heading" aria-level="2">Members</span>
		{#if count !== undefined}<span class="ap-memberlist-count" data-testid={countTestid}>{count}</span>{/if}
		{#if onadd && sections}
			<button class="ap-iconbtn ap-memberlist-addtoggle" type="button" aria-label="Add member" title="Add member" aria-haspopup="dialog" onclick={onadd}><Plus size={16} aria-hidden="true" /></button>
		{/if}
	</div>
	<div class="ap-memberlist-body" data-testid={bodyTestid}>
		{#if placeholder}
			<div class="ap-memberlist-placeholder" aria-hidden="true"><span class="ap-skel" style:width="62%"></span><span class="ap-skel" style:width="48%"></span></div>
		{:else if !sections}
			{#if empty}<p class="ap-memberlist-note">{empty}</p>{/if}
		{:else}
			{#if note}<p class={['ap-memberlist-note', note.error && 'ap-tone-danger']} role={note.error ? 'alert' : 'status'}>{note.text}</p>{/if}
			{#if remark}<p class="ap-memberlist-note">{remark}</p>{/if}
			{#if listed === 0}
				<p class="ap-memberlist-note">No members listed.</p>
			{:else}
				{#if count !== undefined && count > listed}<p class="ap-memberlist-note" data-testid={truncatedTestid}>Showing {listed} of {count}: the most recently active</p>{/if}
				{#each sections as section (section.key)}
					{@const sectionOpen = section.key === 'members' || !shut.includes(section.key)}
					<section class="ap-memberlist-section" data-section={section.key}>
						<!-- Without presence, one list under the panel's own header and count: a Members heading would repeat them. -->
						{#if section.key !== 'members'}
							<FoldHeading class="ap-memberlist-sectionhead" level={3} label={section.label} count={section.people.length} folded={!sectionOpen} onfold={() => ontogglesection?.(section.key)} />
						{/if}
						{#if sectionOpen}
							<ul class="ap-memberlist-people" aria-label={room ? `${section.label} in ${room}` : section.label}>
								{#each section.people as person (person.user_id)}
									{@const name = person.name || person.user_id}
									{@const shown = presence(person.status)}
									{@const words = person.statusLabel ?? presenceLabel(person.status)}
									<!-- The whole row opens their card, as its name does: a press anywhere else on it presses the name, which keyboards reach. Held or right-clicked, it opens its menu. -->
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
									<li class={['ap-member', (shown === 'offline' || shown === 'invisible') && 'ap-member-offline', menuOpen && menu?.person.user_id === person.user_id && 'ap-member-menu']} data-user={person.user_id} data-status={shown}
										{@attach rowMenu(person, name)}
										onclick={(event) => { if (!(event.target as Element).closest('button')) event.currentTarget.querySelector<HTMLButtonElement>('.ap-member-who')?.click(); }}>
										<button class="ap-member-who" type="button" data-user-id={person.user_id} aria-haspopup="dialog" title={words ? `@${person.user_id} · ${words}` : `@${person.user_id}`} onclick={(event) => onprofile?.(person.user_id, event.currentTarget)}>
											{#if avatar}{@render avatar(person)}{:else}<Avatar {name} user_id={person.user_id} src={person.avatar} size="sm" status={person.status} statusLabel={words} />{/if}
											<span class="ap-member-name">
												<bdi class="ap-member-text">{name}</bdi>{#if person.handle}<small class="ap-member-handle">@{person.user_id}</small>{/if}{#if person.you}<small>(you)</small>{/if}{#if words}<span class="ap-sr">, {words.charAt(0).toLowerCase()}{words.slice(1)}</span>{/if}
											</span>
										</button>
										{#if roles}{@render roles(person)}{:else}<RoleBadges roles={person.roles} />{/if}
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
{#if menu}
	<ContextMenu bind:open={menuOpen} x={menu.x} y={menu.y} keyboard={menu.keyboard} label={menu.name} returnFocus={menu.row}
		choices={[{ value: 'remove', label: 'Remove from room', danger: true }]}
		onselect={() => menu && onremove?.(menu.person.user_id)} />
{/if}
