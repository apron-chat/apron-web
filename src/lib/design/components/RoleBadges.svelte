<script module lang="ts">
	import { cssPx } from './util';

	/** One observer for every stacking row on the page (and the flex rows around them), rather than one each. */
	const watchers = new Map<Element, Set<() => void>>();
	let observer: ResizeObserver | undefined;
	function observe(els: Element[], fit: () => void): () => void {
		observer ??= new ResizeObserver((entries) => {
			const due = new Set<() => void>();
			for (const e of entries) for (const f of watchers.get(e.target) ?? []) due.add(f);
			for (const f of due) f();
		});
		for (const el of els) {
			let set = watchers.get(el);
			if (!set) { watchers.set(el, (set = new Set())); observer.observe(el); }
			set.add(fit);
		}
		return () => {
			for (const el of els) {
				const set = watchers.get(el);
				set?.delete(fit);
				if (set && !set.size) { watchers.delete(el); observer?.unobserve(el); }
			}
		};
	}

	/**
	 * Rows waiting for their first fit: fitted together in the next frame, before the browser lays the page out for it.
	 * By then everything that mounted with them (a page of messages, the member list) has been written, so reading them
	 * all lays the page out at most once, where reading each as it mounted laid it out again after every write in
	 * between; and their fits are written together, before the page is laid out to be painted.
	 */
	const firsts = new Set<() => void>();
	function nextFrame(first: () => void): () => void {
		if (!firsts.size) {
			requestAnimationFrame(() => {
				const due = [...firsts];
				firsts.clear();
				for (const f of due) f();
			});
		}
		firsts.add(first);
		return () => firsts.delete(first);
	}

	/**
	 * Computed styles as one fit reads them, each element's at most once: a fit asks an item of its row whether it's in
	 * the flow, how far it gives way and how wide its margins are. (Live, so they're only kept for the one fit.) Each
	 * read is written out, `css.get(el) ?? css.set(el, getComputedStyle(el)).get(el)!`, rather than through a helper, so
	 * that it calls no more of the app's functions than getComputedStyle alone did.
	 */
	type Styles = Map<Element, CSSStyleDeclaration>;

	const flexRow = (s: CSSStyleDeclaration) => /flex/.test(s.display) && s.flexDirection === 'row' && s.flexWrap === 'nowrap';
	const inFlow = (s: CSSStyleDeclaration) => s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed';
	const px = (value: string) => parseFloat(value) || 0;

	/** The flex rows a row of badges sits in, innermost first: its parent, and on up while each is itself an item in a flex row. */
	function flexRows(el: HTMLElement, css: Styles): HTMLElement[] {
		const rows: HTMLElement[] = [];
		for (let at = el.parentElement; at && rows.length < 4; at = at.parentElement) {
			if (!flexRow(css.get(at) ?? css.set(at, getComputedStyle(at)).get(at)!)) break;
			rows.push(at);
		}
		return rows;
	}

	/** Whether this browser sizes a min-width by its box's own content (calc-size), as a name's least is written; without it, names fall back to none. */
	const calcSize = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('min-width', 'calc-size(max-content, size)');

	/**
	 * The least width an item of a flex row shrinks to, in px: its min-width, resolved against its natural width (for
	 * calc-size's `size`; text with an ellipsis can shrink to its min-width and no further) and its row's (for `%`).
	 * Where the browser left a name's least out (no calc-size), it's what that would have been: --ap-name-min, all of
	 * a shorter name, or the row. A min-width that can't be read counts as its current width: it gives up nothing.
	 */
	function least(el: HTMLElement, s: CSSStyleDeclaration, width: number, css: Styles): number {
		if (s.minWidth === 'auto') return s.overflowX === 'visible' ? width : 0;
		const parent = el.parentElement;
		const ps = parent ? (css.get(parent) ?? css.set(parent, getComputedStyle(parent)).get(parent)!) : undefined;
		const percent = parent && ps ? parent.getBoundingClientRect().width - px(ps.borderLeftWidth) - px(ps.borderRightWidth) - px(ps.paddingLeft) - px(ps.paddingRight) : width;
		// Its natural width: all of it where it shows whole (to the fraction), else what its text overflows to.
		const size = el.scrollWidth > el.clientWidth ? el.scrollWidth + px(s.borderLeftWidth) + px(s.borderRightWidth) : width;
		const em = px(s.fontSize) || 16;
		const min = cssPx(s.minWidth, { size, percent, em });
		if (min === undefined) return width;
		if (min === 0 && !calcSize && s.textOverflow === 'ellipsis') {
			const name = cssPx(s.getPropertyValue('--ap-name-min'), { em });
			if (name !== undefined) return Math.min(size, name, percent);
		}
		return min;
	}

	/**
	 * How far an item of the badges' row can still give way to them, in px: an item that gives way before them (a
	 * higher flex-shrink, such as the name) can give up its width down to its least; a row of its own, what its items
	 * can (a member's button: its name, but not the avatar). Counting it is what keeps the fit the same whichever way
	 * the row was resized: narrowing, that item shrinks first and the badges stay whole; widening, it grows back first,
	 * and this is the room the badges may take back from it. It goes below zero where the row has squeezed something
	 * past where it should give way, which only the badges giving up room puts right: an item shrunk below its least,
	 * or one that gives way after them (a handle, there to tell two people apart) cut short.
	 */
	function give(el: Element, below: number, css: Styles): number {
		if (!(el instanceof HTMLElement)) return 0;
		const s = css.get(el) ?? css.set(el, getComputedStyle(el)).get(el)!;
		if (!inFlow(s)) return 0;
		if (!(px(s.flexShrink) > below)) return s.overflowX === 'visible' ? 0 : -Math.max(0, el.scrollWidth - el.clientWidth);
		if (flexRow(s)) return [...el.children].reduce((sum, child) => sum + give(child, below, css), 0);
		const width = el.getBoundingClientRect().width;
		return width - least(el, s, width, css);
	}

	/**
	 * A margin that takes room (asked only of one that isn't 0, whose typed value is slower to read than the rest), unless
	 * it's `auto`: that one only takes up the room left over (something pushed to a row's end), so it's free.
	 */
	function margin(el: Element, value: string, side: 'left' | 'right'): number {
		const typed = typeof el.computedStyleMap === 'function' ? el.computedStyleMap().get(`margin-${side}`) : undefined;
		return typed && typed.toString() === 'auto' ? 0 : px(value);
	}

	/** The room a flex row has left over: its content width less its in-flow items (margins included) and the gaps between them. */
	function free(container: HTMLElement, css: Styles): number {
		const s = css.get(container) ?? css.set(container, getComputedStyle(container)).get(container)!;
		let used = 0;
		let items = 0;
		for (const c of container.children) {
			const cs = css.get(c) ?? css.set(c, getComputedStyle(c)).get(c)!;
			if (!inFlow(cs)) continue;
			items++;
			used += c.getBoundingClientRect().width + (parseFloat(cs.marginLeft) ? margin(c, cs.marginLeft, 'left') : 0) + (parseFloat(cs.marginRight) ? margin(c, cs.marginRight, 'right') : 0);
		}
		const gaps = (parseFloat(s.columnGap) || 0) * Math.max(0, items - 1);
		const content = container.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
		return Math.max(0, content - used - gaps);
	}

	/**
	 * Whether the `--ap-role-overflow` token stacked when a row last read it: a new row's first guess, so that it renders
	 * stacked (or not) from the start. A row that has to change its mind once it reads the token is laid out twice
	 * before it's painted, once each way, and with a row per message and per member that's a layout per batch of them.
	 */
	let tokenStacks = true;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { fitRoles, roleMore, roleMoreChars } from './util';

	/**
	 * A user's `roles` (§3.3): server-assigned labels, shown beside the name as
	 * badges and never as part of it. "admin" and "bot" have their own colors;
	 * other roles show as written. Roles grant nothing on the client.
	 */
	interface Props {
		roles?: string[];
		/**
		 * What happens to badges that don't fit the row: `drop` them whole, or `stack` them behind the last badge that
		 * fits, which ends with how many ("+2"). Defaults to the `--ap-role-overflow` token (`drop` where it's unset).
		 */
		overflow?: 'drop' | 'stack';
		/** On the row of badges. */
		'data-testid'?: string;
	}
	let { roles = [], overflow, 'data-testid': testid }: Props = $props();
	const shown = $derived([...new Set(roles.filter((role) => typeof role === 'string' && role.trim()))]);

	let row = $state<HTMLElement>();
	let stack = $state(untrack(() => (overflow ?? (tokenStacks ? 'stack' : 'drop')) === 'stack'));
	let fit = $state<{ shown: number; room?: number }>({ shown: Infinity });
	/** A badge's font size in px, as last measured: the count's width is in em of it. */
	let em = $state(10);
	/** Each badge's own width as laid out, by role, from when it last wasn't narrowed: a narrowed one can't show it. */
	const natural = new Map<string, number>();

	function measure(): void {
		// Not laid out (in a pane that's hidden): there's no room to read, so the fit waits for it to show.
		if (!row || !stack || (typeof row.checkVisibility === 'function' && !row.checkVisibility())) return;
		const style = getComputedStyle(row);
		const css: Styles = new Map([[row, style]]);
		const badges = [...row.querySelectorAll<HTMLElement>(':scope > .ap-role')];
		if (!badges.length) return;
		const gap = parseFloat(style.columnGap) || 0;
		const size = parseFloat(getComputedStyle(badges[0]).fontSize) || 10;
		if (size !== em) em = size;
		const minRaw = style.getPropertyValue('--ap-role-min').trim();
		const min = minRaw.endsWith('em') ? parseFloat(minRaw) * size : parseFloat(minRaw) || 4 * size;
		const lead = parseFloat(style.getPropertyValue('--ap-role-lead')) || 0;
		// A badge's own width, shown or not, without the count it may end with, as laid out (to the fraction of a pixel,
		// which adds up over a row); for the first while it's narrowed, as it was before, else its role's text and
		// padding (scrollWidth, which ignores the narrowing) plus its border.
		const widths = badges.map((b, i) => {
			const role = shown[i];
			const count = b.querySelector<HTMLElement>(':scope > .ap-role-more');
			if (!b.style.maxWidth) natural.set(role, b.getBoundingClientRect().width - (count?.getBoundingClientRect().width ?? 0));
			const text = b.querySelector<HTMLElement>(':scope > .ap-role-label') ?? b;
			return natural.get(role) ?? text.scrollWidth + (b.offsetWidth - b.clientWidth);
		});
		// The room for badges: what the row has now, plus what the rows around it have spare, plus what the items beside it
		// that give way first (the name, down to its least) can still give up, less the lead before the first badge. So
		// the badges come first, and the fit depends only on the room there is, not on what was shrunk before. Half a
		// pixel to spare keeps layout rounding from cutting the name short by a fraction of a pixel, which its ellipsis
		// would show.
		const rows = flexRows(row, css);
		const own = px(style.flexShrink);
		const yielded = rows[0] ? [...rows[0].children].reduce((sum, item) => (item === row ? sum : sum + give(item, own, css)), 0) : 0;
		const room = row.getBoundingClientRect().width + rows.reduce((sum, r) => sum + free(r, css), 0) + yielded - lead - 0.5;
		const next = fitRoles(widths, room, gap, min, (hidden) => roleMore(hidden, size));
		if (next.shown !== fit.shown || next.room !== fit.room) fit = next;
	}

	/** Stacked or dropped: as the prop says, else as the `--ap-role-overflow` token does. Dropped, every badge is whole. */
	function overflows(el: HTMLElement): void {
		const token = overflow ?? getComputedStyle(el).getPropertyValue('--ap-role-overflow').trim();
		if (overflow === undefined) tokenStacks = token === 'stack';
		stack = token === 'stack';
		if (!stack) fit = { shown: Infinity };
	}

	$effect(() => {
		if (!row) return;
		void shown.join('\n');
		const el = row;
		if (overflow === 'drop' || typeof ResizeObserver === 'undefined') {
			// Nothing to fit, or nothing to say when to fit it again: every badge whole.
			untrack(() => overflows(el));
			fit = { shown: Infinity };
			return;
		}
		// Fitted in the next frame, with every row that mounted before it; and again whenever the row, the rows around it,
		// or what shares its row (whose widths are its room) change size. The row is observed from the start, which also
		// fits it as it's first laid out, should that come first (it mounted as the browser was drawing a frame).
		let unwatch = observe([el], measure);
		const cancel = nextFrame(() => {
			overflows(el);
			if (!stack) {
				unwatch();
				return;
			}
			const rows = flexRows(el, new Map());
			const around = observe([...rows, ...[...(rows[0]?.children ?? [])].filter((item) => item !== el)], measure);
			const own = unwatch;
			unwatch = () => {
				own();
				around();
			};
			measure();
		});
		return () => {
			cancel();
			unwatch();
		};
	});

	const last = $derived(Math.min(fit.shown, shown.length) - 1);
	const behind = $derived(stack && last < shown.length - 1 ? shown.slice(last + 1) : []);
</script>

<!-- The last badge shown, with roles behind it, ends with how many: its words (screen readers read the roles behind it themselves). -->
{#if shown.length}
	<span class={['ap-roles', stack && 'ap-roles-stack', stack && fit.shown === 0 && 'ap-roles-gone']} data-testid={testid} bind:this={row}>{#each shown as role, i (role)}{@const front = stack && i === last && behind.length > 0}<span
			class={['ap-role', role === 'admin' && 'ap-role-admin', role === 'bot' && 'ap-role-bot', front && 'ap-role-stacked', stack && i > last && 'ap-role-behind']}
			style:max-width={stack && i === last && fit.room !== undefined ? `${fit.room + roleMore(behind.length, em)}px` : undefined}
			title={front ? `Roles: ${shown.join(', ')}` : `Role: ${role}`}>{#if front}<span class="ap-role-label">{role}</span><span class="ap-role-more" style:--ap-role-more-chars={roleMoreChars(behind.length)} aria-hidden="true"><span class="ap-role-plus">+</span>{behind.length}</span>{:else}{role}{/if}</span>{/each}</span>
{/if}
