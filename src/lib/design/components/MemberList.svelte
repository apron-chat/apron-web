<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import Plus from '@lucide/svelte/icons/plus';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Avatar from './Avatar.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import FoldHeading from './FoldHeading.svelte';
	import { hold } from './hold';
	import RoleBadges from './RoleBadges.svelte';
	import type { ContextMenuChoice, MemberListPerson, MemberListSection } from './types';
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
		/** A change is under way (a remove, or a direct message being started): the rows' menus offer only Profile. */
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
	 * A row's menu: Profile, then Direct message (not to a system identity) and Remove from room on everyone but you,
	 * where offered, neither while a change is under way. Pressing the row drops it down beneath the row; a right-click,
	 * the context menu key or a long press opens it where that was.
	 */
	let menu = $state<{ person: MemberListPerson; name: string; x: number; y: number; keyboard?: true; who: HTMLElement; choices: ContextMenuChoice[] } | undefined>();
	let menuOpen = $state(false);
	/**
	 * A press on the row whose menu is open: it closes the menu, and the click that follows doesn't open it again. Gone
	 * once that press is over, whether a click followed or not (a scroll, a drag off the row).
	 */
	let closing: string | undefined;
	const menuId = $props.id();

	function choicesFor(person: MemberListPerson): ContextMenuChoice[] {
		const choices: ContextMenuChoice[] = [{ value: 'profile', label: 'Profile', icon: UserRound }];
		if (person.you || busy) return choices;
		if (onmessage && !person.system) choices.push({ value: 'message', label: 'Direct message', icon: MessageCircle });
		if (onremove) choices.push({ value: 'remove', label: 'Remove from room', danger: true, icon: UserMinus });
		return choices;
	}

	/** Who a row is, by its `data-user`: what a press on it reads, from the people as they are now. */
	const byId = $derived(new Map((sections ?? []).flatMap((section) => section.people.map((person) => [person.user_id, person] as const))));
	const nameOf = (person: MemberListPerson) => person.name || person.user_id;

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
			// Put away by this press: focus back on the name, as Escape leaves it.
			closing = undefined;
			who.focus();
			return;
		}
		const row = who.closest('li') ?? who;
		const box = row.getBoundingClientRect(), start = who.getBoundingClientRect();
		const rtl = getComputedStyle(row).direction === 'rtl';
		if (!show(person, name, who, { x: rtl ? start.right : start.left, y: box.bottom + 2, ...(keyboard ? { keyboard: true as const } : {}) })) onprofile?.(person.user_id, who);
	}

	/**
	 * One hold for every row, reading who the row is when it fires: the people are rebuilt on each presence change and
	 * minute, and a hold made from them would be made anew mid-press, its timer lost.
	 */
	const rowMenu = hold((at, row) => {
		const person = byId.get(row.dataset.user ?? '');
		return person ? show(person, nameOf(person), row.querySelector<HTMLElement>('.ap-member-who') ?? row, at) : false;
	});

	/** A press on the row whose menu is open, noted until it's over. */
	function pressing(userId: string): void {
		if (!menuOpen || menu?.person.user_id !== userId) return;
		closing = userId;
		const done = () => setTimeout(() => (closing = undefined));
		addEventListener('pointerup', done, { once: true, capture: true });
		addEventListener('pointercancel', done, { once: true, capture: true });
	}

	/** ↓ or ↑ on the name opens its menu, as on a menu button. */
	function namekey(event: KeyboardEvent, person: MemberListPerson, name: string): void {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		if (choicesFor(person).length < 2) return;
		event.preventDefault();
		press(event.currentTarget as HTMLElement, person, name, true);
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
									{@const menued = choicesFor(person).length > 1}
									{@const opened = menuOpen && menu?.person.user_id === person.user_id}
									<!-- The whole row is its name's: a press anywhere else on it presses the name (which keyboards reach), dropping its menu down. Held or right-clicked, the menu opens there. -->
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
									<li class={['ap-member', (shown === 'offline' || shown === 'invisible') && 'ap-member-offline', opened && 'ap-member-menu']} data-user={person.user_id} data-status={shown}
										{@attach rowMenu}
										onpointerdown={() => pressing(person.user_id)}
										onclick={(event) => { const who = event.currentTarget.querySelector<HTMLElement>('.ap-member-who'); if (who && !(event.target as Element).closest('button')) press(who, person, name, false); }}>
										<button class="ap-member-who" type="button" data-user-id={person.user_id} aria-haspopup={menued ? 'menu' : 'dialog'} aria-expanded={menued ? opened : undefined} aria-controls={opened ? menuId : undefined} title={words ? `@${person.user_id} · ${words}` : `@${person.user_id}`} onclick={(event) => press(event.currentTarget, person, name, event.detail === 0)} onkeydown={(event) => namekey(event, person, name)}>
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
	<ContextMenu bind:open={menuOpen} id={menuId} x={menu.x} y={menu.y} keyboard={menu.keyboard} label={menu.name} returnFocus={menu.who} choices={menu.choices} onselect={choose} />
{/if}
