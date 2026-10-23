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

	const flexRow = (s: CSSStyleDeclaration) => /flex/.test(s.display) && s.flexDirection === 'row' && s.flexWrap === 'nowrap';
	const inFlow = (s: CSSStyleDeclaration) => s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed';
	const px = (value: string) => parseFloat(value) || 0;

	/** The flex rows a row of badges sits in, innermost first: its parent, and on up while each is itself an item in a flex row. */
	function flexRows(el: HTMLElement): HTMLElement[] {
		const rows: HTMLElement[] = [];
		for (let at = el.parentElement; at && rows.length < 4; at = at.parentElement) {
			if (!flexRow(getComputedStyle(at))) break;
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
	function least(el: HTMLElement, s: CSSStyleDeclaration, width: number): number {
		const parent = el.parentElement;
		const ps = parent ? getComputedStyle(parent) : undefined;
		const percent = parent && ps ? parent.getBoundingClientRect().width - px(ps.borderLeftWidth) - px(ps.borderRightWidth) - px(ps.paddingLeft) - px(ps.paddingRight) : width;
		// Its natural width: all of it where it shows whole (to the fraction), else what its text overflows to.
		const size = el.scrollWidth > el.clientWidth ? el.scrollWidth + px(s.borderLeftWidth) + px(s.borderRightWidth) : width;
		const em = px(s.fontSize) || 16;
		if (s.minWidth === 'auto') return s.overflowX === 'visible' ? width : 0;
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
	function give(el: Element, below: number): number {
		if (!(el instanceof HTMLElement)) return 0;
		const s = getComputedStyle(el);
		if (!inFlow(s)) return 0;
		if (!(px(s.flexShrink) > below)) return s.overflowX === 'visible' ? 0 : -Math.max(0, el.scrollWidth - el.clientWidth);
		if (flexRow(s)) return [...el.children].reduce((sum, child) => sum + give(child, below), 0);
		const width = el.getBoundingClientRect().width;
		return width - least(el, s, width);
	}

	/** A margin, unless it's `auto`: that one only takes up the room left over (a member row's remove button, pushed to the end), so it's free. */
	function margin(el: HTMLElement, s: CSSStyleDeclaration, side: 'left' | 'right'): number {
		const typed = typeof el.computedStyleMap === 'function' ? el.computedStyleMap().get(`margin-${side}`) : undefined;
		if (typed && typed.toString() === 'auto') return 0;
		return px(side === 'left' ? s.marginLeft : s.marginRight);
	}

	/** The room a flex row has left over: its content width less its in-flow items (margins included) and the gaps between them. */
	function free(container: HTMLElement): number {
		const s = getComputedStyle(container);
		const items = [...container.children].filter((c): c is HTMLElement => inFlow(getComputedStyle(c)));
		const used = items.reduce((sum, c) => {
			const cs = getComputedStyle(c);
			return sum + c.getBoundingClientRect().width + margin(c, cs, 'left') + margin(c, cs, 'right');
		}, 0);
		const gaps = (parseFloat(s.columnGap) || 0) * Math.max(0, items.length - 1);
		const content = container.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
		return Math.max(0, content - used - gaps);
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { fitRoles, rolePeek, ROLE_PEEK, ROLE_STACK_MAX } from './util';

	/**
	 * A user's `roles` (§3.3): server-assigned labels, shown beside the name as
	 * badges and never as part of it. "admin" and "bot" have their own colors;
	 * other roles show as written. Roles grant nothing on the client.
	 */
	interface Props {
		roles?: string[];
		testid?: string;
		/**
		 * What happens to badges that don't fit the row: `drop` them whole, or `stack` them as layers behind the last
		 * badge that fits. Defaults to the `--ap-role-overflow` token (`drop` where it's unset).
		 */
		overflow?: 'drop' | 'stack';
	}
	let { roles = [], testid, overflow }: Props = $props();
	const shown = $derived([...new Set(roles.filter((role) => typeof role === 'string' && role.trim()))]);

	let row = $state<HTMLElement>();
	let stack = $state(false);
	let fit = $state<{ shown: number; room?: number }>({ shown: Infinity });
	/** Each badge's own width as laid out, by role, from when it last wasn't narrowed: a narrowed one can't show it. */
	const natural = new Map<string, number>();

	const kind = (role: string) => (role === 'admin' ? 'admin' : role === 'bot' ? 'bot' : 'other');

	/** The layers behind the last badge shown: one box-shadow pair per stacked role, each the badge's own size and a step further out, its fill 1px inside its edge. */
	function layers(behind: string[]): string {
		return behind.slice(0, ROLE_STACK_MAX).flatMap((role, i) => {
			const k = kind(role);
			const x = ROLE_PEEK * (i + 1);
			return [`${x}px 0 0 -1px var(--ap-role-${k}-fill)`, `${x}px 0 0 0 var(--ap-role-${k}-line)`];
		}).join(', ');
	}

	function measure(): void {
		// Not laid out (in a pane that's hidden): there's no room to read, so the fit waits for it to show.
		if (!row || (typeof row.checkVisibility === 'function' && !row.checkVisibility())) return;
		const badges = [...row.querySelectorAll<HTMLElement>(':scope > .ap-role')];
		if (!badges.length) return;
		const style = getComputedStyle(row);
		const gap = parseFloat(style.columnGap) || 0;
		const em = parseFloat(getComputedStyle(badges[0]).fontSize) || 10;
		const minRaw = style.getPropertyValue('--ap-role-min').trim();
		const min = minRaw.endsWith('em') ? parseFloat(minRaw) * em : parseFloat(minRaw) || 4 * em;
		const lead = parseFloat(style.getPropertyValue('--ap-role-lead')) || 0;
		// A badge's own width, shown or not, as laid out (to the fraction of a pixel, which adds up over a row); for the
		// first while it's narrowed, as it was before, else its text and padding (scrollWidth, which ignores the
		// narrowing) plus its border.
		const widths = badges.map((b) => {
			const role = b.textContent ?? '';
			if (!b.style.maxWidth) natural.set(role, b.getBoundingClientRect().width);
			return natural.get(role) ?? b.scrollWidth + (b.offsetWidth - b.clientWidth);
		});
		// The room for badges: what the row has now, plus what the rows around it have spare, plus what the items beside it
		// that give way first (the name, down to its least) can still give up, less the lead before the first badge. So
		// the badges come first, and the fit depends only on the room there is, not on what was shrunk before. Half a
		// pixel to spare keeps layout rounding from cutting the name short by a fraction of a pixel, which its ellipsis
		// would show.
		const rows = flexRows(row);
		const own = px(style.flexShrink);
		const yielded = rows[0] ? [...rows[0].children].reduce((sum, item) => (item === row ? sum : sum + give(item, own)), 0) : 0;
		const room = row.getBoundingClientRect().width + rows.reduce((sum, r) => sum + free(r), 0) + yielded - lead - 0.5;
		const next = fitRoles(widths, room, gap, min);
		if (next.shown !== fit.shown || next.room !== fit.room) fit = next;
	}

	$effect(() => {
		if (!row) return;
		const token = getComputedStyle(row).getPropertyValue('--ap-role-overflow').trim();
		stack = (overflow ?? token) === 'stack';
		if (!stack || typeof ResizeObserver === 'undefined') { fit = { shown: Infinity }; return; }
		void shown.join('\n');
		const el = row;
		untrack(measure);
		// The rows around it, and what shares its row, whose widths are its room.
		const rows = flexRows(el);
		return observe([el, ...rows, ...[...(rows[0]?.children ?? [])].filter((item) => item !== el)], measure);
	});

	const last = $derived(Math.min(fit.shown, shown.length) - 1);
	const behind = $derived(stack && last < shown.length - 1 ? shown.slice(last + 1) : []);
</script>

{#if shown.length}
	<span class={['ap-roles', stack && 'ap-roles-stack', stack && fit.shown === 0 && 'ap-roles-gone']} data-testid={testid} bind:this={row}>{#each shown as role, i (role)}<span
			class={['ap-role', role === 'admin' && 'ap-role-admin', role === 'bot' && 'ap-role-bot', stack && i === last && behind.length && 'ap-role-stacked', stack && i > last && 'ap-role-behind']}
			style:max-width={stack && i === last && fit.room !== undefined ? `${fit.room}px` : undefined}
			style:box-shadow={stack && i === last && behind.length ? layers(behind) : undefined}
			style:margin-right={stack && i === last && behind.length ? `${rolePeek(behind.length)}px` : undefined}
			title={stack && i === last && behind.length ? `Roles: ${shown.join(', ')}` : `Role: ${role}`}>{role}</span>{/each}</span>
{/if}
