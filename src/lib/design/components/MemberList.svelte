<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import Plus from '@lucide/svelte/icons/plus';
	import Avatar from './Avatar.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import FoldHeading from './FoldHeading.svelte';
	import { hold } from './hold';
	import RoleBadges from './RoleBadges.svelte';
	import type { MemberListPerson, MemberListSection, MenuChoice } from './types';
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
		/**
		 * Open their profile, from the row's button: its menu's Profile, or pressing the row itself where Profile is all
		 * its menu would hold (your own row, with nothing else offered).
		 */
		onprofile?: (userId: string, anchor: HTMLElement) => void;
		/** Offer Direct message in every row's menu but yours: open or start a private conversation with them. */
		onmessage?: (userId: string) => void;
		/** Offer removing members (`room_leave` with `user_id`, §4.2.2): Remove from room, in every row's menu but yours. */
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
		open = true, room, count, sections, empty, placeholder = false, shut = [], ontogglesection, onprofile, onmessage, onremove,
		onadd, busy = false, note, remark, avatar, roles, countTestid, bodyTestid, truncatedTestid, class: className
	}: Props = $props();

	const listed = $derived((sections ?? []).reduce((total, section) => total + section.people.length, 0));

	/**
	 * A row's menu: Profile, then Direct message and Remove from room on everyone but you, where offered (Remove not while
	 * one is under way). Pressing the row drops it down beneath the row; a right-click, the context menu key or a long
	 * press opens it where that was.
	 */
	let menu = $state<{ person: MemberListPerson; name: string; x: number; y: number; keyboard?: true; who: HTMLElement; choices: (MenuChoice & { danger?: boolean })[] } | undefined>();
	let menuOpen = $state(false);
	/** A press on the row whose menu is open: it closes the menu, and the click that follows doesn't open it again. */
	let closing: string | undefined;

	function choicesFor(person: MemberListPerson): (MenuChoice & { danger?: boolean })[] {
		const choices: (MenuChoice & { danger?: boolean })[] = [{ value: 'profile', label: 'Profile' }];
		if (person.you) return choices;
		if (onmessage) choices.push({ value: 'message', label: 'Direct message' });
		if (onremove && !busy) choices.push({ value: 'remove', label: 'Remove from room', danger: true });
		return choices;
	}

	function show(person: MemberListPerson, name: string, who: HTMLElement, at: { x: number; y: number; keyboard?: true }): boolean {
		const choices = choicesFor(person);
		if (choices.length < 2) return false;
		closing = undefined;
		menu = { person, name, ...at, who, choices };
		menuOpen = true;
		return true;
	}

	/**
	 * The row pressed (its name, or anywhere on it): the menu dropped down beneath it, or straight to their profile where
	 * that's all it holds. From the keyboard (Enter or Space on the name) its first choice is focused, as a menu button's.
	 */
	function press(who: HTMLElement, person: MemberListPerson, name: string, keyboard: boolean): void {
		if (closing === person.user_id) {
			closing = undefined;
			return;
		}
		const row = who.closest('li') ?? who;
		const box = row.getBoundingClientRect(), start = who.getBoundingClientRect();
		const rtl = getComputedStyle(row).direction === 'rtl';
		if (!show(person, name, who, { x: rtl ? start.right : start.left, y: box.bottom + 2, ...(keyboard ? { keyboard: true as const } : {}) })) onprofile?.(person.user_id, who);
	}

	function rowMenu(person: MemberListPerson, name: string) {
		return hold((at, row) => show(person, name, row.querySelector<HTMLElement>('.ap-member-who') ?? row, at));
	}

	function choose(value: string): void {
		if (!menu) return;
		const { person, who } = menu;
		if (value === 'profile') onprofile?.(person.user_id, who);
		else if (value === 'message') onmessage?.(person.user_id);
		else if (value === 'remove') onremove?.(person.user_id);
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
									<!-- The whole row is its name's: a press anywhere else on it presses the name (which keyboards reach), dropping its menu down. Held or right-clicked, the menu opens there. -->
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
									<li class={['ap-member', (shown === 'offline' || shown === 'invisible') && 'ap-member-offline', menuOpen && menu?.person.user_id === person.user_id && 'ap-member-menu']} data-user={person.user_id} data-status={shown}
										{@attach rowMenu(person, name)}
										onpointerdown={() => { if (menuOpen && menu?.person.user_id === person.user_id) closing = person.user_id; }}
										onclick={(event) => { const who = event.currentTarget.querySelector<HTMLElement>('.ap-member-who'); if (who && !(event.target as Element).closest('button')) press(who, person, name, false); }}>
										<button class="ap-member-who" type="button" data-user-id={person.user_id} aria-haspopup={choicesFor(person).length > 1 ? 'menu' : 'dialog'} aria-expanded={choicesFor(person).length > 1 ? menuOpen && menu?.person.user_id === person.user_id : undefined} title={words ? `@${person.user_id} · ${words}` : `@${person.user_id}`} onclick={(event) => press(event.currentTarget, person, name, event.detail === 0)}>
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
	<ContextMenu bind:open={menuOpen} x={menu.x} y={menu.y} keyboard={menu.keyboard} label={menu.name} returnFocus={menu.who} choices={menu.choices} onselect={choose} />
{/if}
