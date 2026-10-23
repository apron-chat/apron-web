// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleBadges from './RoleBadges.svelte';
import * as dom from '$lib/test/dom';

/** The width the row of badges is laid out at; jsdom has no layout, so the row reports this and each badge is 10px a letter. */
let rowWidth = 0;
/** What else reports a width: an element by its `data-width`. */
const widthOf = (el: HTMLElement) => (el.classList.contains('ap-roles') ? rowWidth : el.classList.contains('ap-role') ? (el.textContent ?? '').length * 10 : Number(el.dataset.width ?? 0));

beforeEach(() => {
	dom.stubResizeObserver();
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		return { width: widthOf(this), left: 0, right: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
	});
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
		return this.classList.contains('ap-role') ? (this.textContent ?? '').length * 10 : 0;
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const ROLES = ['moderator', 'admin', 'bot', 'oncall'];

function render(props: { roles: string[]; overflow?: 'drop' | 'stack' }, width = 1000, target: HTMLElement = document.body): HTMLElement[] {
	rowWidth = width;
	dom.render(RoleBadges, props, { target });
	return [...document.querySelectorAll<HTMLElement>('.ap-role')];
}

describe('RoleBadges', () => {
	it('drops where neither the --ap-role-overflow token (which the design system sets to stack) nor the prop asks it to stack: every badge in the row, nothing stacked or measured', () => {
		const badges = render({ roles: ROLES }, 60);
		expect(badges.map((b) => b.className)).toEqual(['ap-role', 'ap-role ap-role-admin', 'ap-role ap-role-bot', 'ap-role']);
		expect(document.querySelector('.ap-roles')!.className).toBe('ap-roles');
		expect(badges[0].title).toBe('Role: moderator');
	});

	it('stacks what does not fit behind the last badge that does, in each role\'s colors, and names them all', () => {
		// moderator 90px, then admin to 140: with three stacked behind the first (12px), 102px holds one badge (with half
		// a pixel to spare).
		const badges = render({ roles: ROLES, overflow: 'stack' }, 102.5);
		expect(document.querySelector('.ap-roles')!.classList.contains('ap-roles-stack')).toBe(true);
		const [front, ...rest] = badges;
		expect(front.classList.contains('ap-role-stacked')).toBe(true);
		expect(front.title).toBe('Roles: moderator, admin, bot, oncall');
		expect(front.style.marginRight).toBe('12px');
		const shadow = front.style.boxShadow;
		expect(shadow.indexOf('--ap-role-admin-fill')).toBeLessThan(shadow.indexOf('--ap-role-bot-fill'));
		expect(shadow.indexOf('--ap-role-bot-fill')).toBeLessThan(shadow.indexOf('--ap-role-other-fill'));
		// The rest stay in the DOM, for screen readers, behind it.
		expect(rest.every((b) => b.classList.contains('ap-role-behind'))).toBe(true);
	});

	it('shows two whole badges where they and the one stacked behind fit', () => {
		// moderator, admin end at 140; bot 170; one behind adds 4: 144.
		const badges = render({ roles: ['moderator', 'admin', 'bot'], overflow: 'stack' }, 144.5);
		expect(badges.map((b) => [b.classList.contains('ap-role-stacked'), b.classList.contains('ap-role-behind')])).toEqual([[false, false], [true, false], [false, true]]);
	});

	it('shows every badge, unstacked, where the whole row fits', () => {
		const badges = render({ roles: ROLES, overflow: 'stack' }, 230.5);
		expect(badges.some((b) => b.classList.contains('ap-role-stacked') || b.classList.contains('ap-role-behind'))).toBe(false);
	});

	it('narrows the first badge to its minimum, then shows none and takes no room', () => {
		// The first badge (90px) and its stack (12px) want 102px; with 90.5 it narrows to 78, the room left beside the stack.
		const narrow = render({ roles: ROLES, overflow: 'stack' }, 90.5);
		expect(narrow[0].style.maxWidth).toBe('78px');
		dom.unmount();
		const none = render({ roles: ROLES, overflow: 'stack' }, 30);
		expect(none.every((b) => b.classList.contains('ap-role-behind'))).toBe(true);
		expect(document.querySelector('.ap-roles')!.classList.contains('ap-roles-gone')).toBe(true);
	});

	/** A flex row with a name (giving way before the badges, down to 60px) and a time (never giving way), the badges between. */
	function row(name: number): HTMLElement {
		const head = document.createElement('div');
		head.setAttribute('style', 'display: flex; flex-direction: row; flex-wrap: nowrap');
		head.innerHTML = `<span class="name" style="flex-shrink: 1e12; min-width: 60px" data-width="${name}"></span><span class="time" style="flex-shrink: 0" data-width="40"></span>`;
		document.body.append(head);
		return head;
	}
	const state = () => [...document.querySelectorAll<HTMLElement>('.ap-role')].map((b) => (b.classList.contains('ap-role-behind') ? 'behind' : b.classList.contains('ap-role-stacked') ? 'stacked' : 'whole'));

	it('takes the room the name beside it can still give up, so it fits the same whichever way the row was resized', () => {
		// The name whole at 140px can give up 80 more: the badges have 60 + 80, which holds one with three behind it.
		const head = row(140);
		render({ roles: ROLES, overflow: 'stack' }, 60, head);
		expect(state()).toEqual(['stacked', 'behind', 'behind', 'behind']);
		dom.unmount();
		document.body.innerHTML = '';
		// The same room, split the other way (the name already down to its least): the same fit.
		render({ roles: ROLES, overflow: 'stack' }, 140, row(60));
		expect(state()).toEqual(['stacked', 'behind', 'behind', 'behind']);
		dom.unmount();
		document.body.innerHTML = '';
		// What never gives way (the time) is not room: alone, 80px only narrows the first.
		const bare = document.createElement('div');
		bare.setAttribute('style', 'display: flex; flex-direction: row; flex-wrap: nowrap');
		bare.innerHTML = '<span style="flex-shrink: 0" data-width="200"></span>';
		document.body.append(bare);
		render({ roles: ROLES, overflow: 'stack' }, 80, bare);
		expect(document.querySelector<HTMLElement>('.ap-role')!.style.maxWidth).toBe('67px');
	});
});
