<script module lang="ts">
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

	/** The flex rows a row of badges sits in, innermost first: its parent, and on up while each is itself an item in a flex row. */
	function flexRows(el: HTMLElement): HTMLElement[] {
		const rows: HTMLElement[] = [];
		for (let at = el.parentElement; at && rows.length < 4; at = at.parentElement) {
			const s = getComputedStyle(at);
			if (!/flex/.test(s.display) || s.flexDirection !== 'row' || s.flexWrap !== 'nowrap') break;
			rows.push(at);
		}
		return rows;
	}

	/** The room a flex row has left over: its content width less its in-flow items (margins included) and the gaps between them. */
	function free(container: HTMLElement): number {
		const s = getComputedStyle(container);
		const items = [...container.children].filter((c): c is HTMLElement => {
			const cs = getComputedStyle(c);
			return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed';
		});
		const used = items.reduce((sum, c) => {
			const cs = getComputedStyle(c);
			return sum + c.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
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
		if (!row) return;
		const badges = [...row.querySelectorAll<HTMLElement>(':scope > .ap-role')];
		if (!badges.length) return;
		const style = getComputedStyle(row);
		const gap = parseFloat(style.columnGap) || 0;
		const em = parseFloat(getComputedStyle(badges[0]).fontSize) || 10;
		const minRaw = style.getPropertyValue('--ap-role-min').trim();
		const min = minRaw.endsWith('em') ? parseFloat(minRaw) * em : parseFloat(minRaw) || 4 * em;
		const lead = parseFloat(style.getPropertyValue('--ap-role-lead')) || 0;
		// A badge's own width, shown or not: its text and padding (scrollWidth, which ignores any narrowing) plus its border.
		const widths = badges.map((b) => b.scrollWidth + (b.offsetWidth - b.clientWidth));
		// The room for badges: what the row has now plus what the rows around it have spare, less the lead before the
		// first badge. Spare room only appears once whatever shares those rows (the name) is whole, so it keeps priority.
		// Half a pixel of slack keeps layout rounding from flipping a fit back and forth.
		const room = row.getBoundingClientRect().width + flexRows(row).reduce((sum, r) => sum + free(r), 0) - lead + 0.5;
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
		return observe([el, ...flexRows(el)], measure);
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
