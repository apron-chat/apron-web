// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleBadges from './RoleBadges.svelte';
import { fitRoles, roleMore, roleMoreChars } from './util';
import * as dom from '$lib/test/dom';

/*
 * jsdom has no layout. These tests give the row of badges a width, and each badge 10px a letter, and check that the
 * component lays out what `fitRoles` (tested in util.test.ts) answers for that room. Real layout is checked in a browser.
 */

/** The width the row of badges is laid out at. */
let rowWidth = 0;
/** A badge's role, without the count it may end with. */
const roleOf = (el: HTMLElement) => el.querySelector('.ap-role-label')?.textContent ?? el.textContent ?? '';
/** jsdom's font size, which a count's width is in em of. */
const EM = 16;
/** A count's width, as RoleBadges counts it. */
const countOf = (el: HTMLElement | null) => (el ? roleMore(Number((el.textContent ?? '').slice(1)), EM) : 0);
/** What else reports a width: a badge 10px a letter and its count, a count as counted, anything else by its `data-width`. */
const widthOf = (el: HTMLElement) => (el.classList.contains('ap-roles') ? rowWidth
	: el.classList.contains('ap-role') ? roleOf(el).length * 10 + countOf(el.querySelector('.ap-role-more'))
	: el.classList.contains('ap-role-more') ? countOf(el)
	: Number(el.dataset.width ?? 0));
let measured: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	dom.stubResizeObserver();
	measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		return { width: widthOf(this), left: 0, right: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
	});
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
		return this.classList.contains('ap-role') || this.classList.contains('ap-role-label') ? roleOf(this).length * 10 : 0;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const ROLES = ['moderator', 'admin', 'bot', 'oncall'];
/** As a badge reports them: 10px a letter. */
const WIDTHS = ROLES.map((role) => role.length * 10);
/** In jsdom the row has no gap, and a badge's least is RoleBadges' fallback, 4em of its font. */
const GAP = 0;
const MIN = 4 * EM;

function render(props: { roles: string[]; overflow?: 'drop' | 'stack' }, width = 1000, target: HTMLElement = document.body): HTMLElement[] {
	rowWidth = width;
	dom.render(RoleBadges, props, { target });
	return [...document.querySelectorAll<HTMLElement>('.ap-role')];
}

/** Each badge as shown: whole, the stacked front of those behind it, or behind (out of sight, still in the DOM). */
const state = () => [...document.querySelectorAll<HTMLElement>('.ap-role')].map((b) => (b.classList.contains('ap-role-behind') ? 'behind' : b.classList.contains('ap-role-stacked') ? 'stacked' : 'whole'));

describe('RoleBadges', () => {
	it('drops where neither the --ap-role-overflow token (which the design system sets to stack) nor the prop asks it to stack: every badge in the row in its role’s colors, nothing stacked or measured', () => {
		const badges = render({ roles: ROLES }, 60);
		expect(state()).toEqual(['whole', 'whole', 'whole', 'whole']);
		expect(badges.map((b) => [b.classList.contains('ap-role-admin'), b.classList.contains('ap-role-bot')])).toEqual([[false, false], [true, false], [false, true], [false, false]]);
		expect(badges.map((b) => b.title)).toEqual(ROLES.map((role) => `Role: ${role}`));
		expect(measured).not.toHaveBeenCalled();
	});

	it('stacks as fitRoles answers for the room: whole badges, the last one narrowed where asked, the rest behind it in order, named on its title', () => {
		for (const width of [230.5, 152.5, 102.5, 90.5, 30]) {
			const badges = render({ roles: ROLES, overflow: 'stack' }, width);
			// Half a pixel to spare, for layout's rounding.
			const { shown, room } = fitRoles(WIDTHS, width - 0.5, GAP, MIN, (hidden) => roleMore(hidden, EM));
			const behind = ROLES.length - shown;
			const expected = ROLES.map((_, i) => (i >= shown ? 'behind' : i === shown - 1 && behind ? 'stacked' : 'whole'));
			expect(state(), `${width}px`).toEqual(expected);
			expect(document.querySelector('.ap-roles')!.classList.contains('ap-roles-gone'), `${width}px`).toBe(shown === 0);
			if (shown > 0 && behind) {
				const front = badges[shown - 1];
				expect(front.title).toBe(`Roles: ${ROLES.join(', ')}`);
				expect(front.style.maxWidth).toBe(room === undefined ? '' : `${room + roleMore(behind, EM)}px`);
				// Its role, then how many are behind it: as wide as counted, and hidden from screen readers, which read those roles themselves.
				const count = front.querySelector<HTMLElement>('.ap-role-more')!;
				expect([front.querySelector('.ap-role-label')?.textContent, count.textContent, count.getAttribute('aria-hidden')], `${width}px`).toEqual([ROLES[shown - 1], `+${behind}`, 'true']);
				expect(count.style.getPropertyValue('--ap-role-more-chars')).toBe(String(roleMoreChars(behind)));
			}
			dom.cleanup();
		}
	});

	/** A flex row with a name (giving way before the badges, down to 60px) and a time (never giving way), the badges between. */
	function row(name: number): HTMLElement {
		const head = document.createElement('div');
		head.setAttribute('style', 'display: flex; flex-direction: row; flex-wrap: nowrap');
		head.innerHTML = `<span class="name" style="flex-shrink: 1e12; min-width: 60px" data-width="${name}"></span><span class="time" style="flex-shrink: 0" data-width="40"></span>`;
		document.body.append(head);
		return head;
	}

	it('takes the room the name beside it can still give up, so it fits the same whichever way the row was resized', () => {
		// The name whole at 140px can give up 80 more: the badges have 60 + 80, which holds one with three behind it.
		const head = row(140);
		render({ roles: ROLES, overflow: 'stack' }, 60, head);
		expect(state()).toEqual(['stacked', 'behind', 'behind', 'behind']);
		dom.cleanup();
		// The same room, split the other way (the name already down to its least): the same fit.
		render({ roles: ROLES, overflow: 'stack' }, 140, row(60));
		expect(state()).toEqual(['stacked', 'behind', 'behind', 'behind']);
		dom.cleanup();
		// What never gives way (the time) is not room: alone, 110px only narrows the first, its count kept whole.
		const bare = document.createElement('div');
		bare.setAttribute('style', 'display: flex; flex-direction: row; flex-wrap: nowrap');
		bare.innerHTML = '<span style="flex-shrink: 0" data-width="200"></span>';
		document.body.append(bare);
		render({ roles: ROLES, overflow: 'stack' }, 110, bare);
		expect(document.querySelector<HTMLElement>('.ap-role')!.style.maxWidth).toBe(`${Math.floor(110 - 0.5 - roleMore(3, EM)) + roleMore(3, EM)}px`);
	});
});
