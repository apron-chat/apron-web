// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RoleBadges from './RoleBadges.svelte';

let instance: ReturnType<typeof mount> | undefined;
/** The width the row of badges is laid out at; jsdom has no layout, so the row reports this and each badge is 10px a letter. */
let rowWidth = 0;

beforeEach(() => {
	vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
		return { width: this.classList.contains('ap-roles') ? rowWidth : 0, left: 0, right: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
	});
	vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
		return this.classList.contains('ap-role') ? (this.textContent ?? '').length * 10 : 0;
	});
});

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const ROLES = ['moderator', 'admin', 'bot', 'oncall'];

function render(props: { roles: string[]; overflow?: 'drop' | 'stack' }, width = 1000): HTMLElement[] {
	rowWidth = width;
	instance = mount(RoleBadges, { target: document.body, props });
	flushSync();
	return [...document.querySelectorAll<HTMLElement>('.ap-role')];
}

describe('RoleBadges', () => {
	it('drops by default: every badge in the row, nothing stacked or measured', () => {
		const badges = render({ roles: ROLES }, 60);
		expect(badges.map((b) => b.className)).toEqual(['ap-role', 'ap-role ap-role-admin', 'ap-role ap-role-bot', 'ap-role']);
		expect(document.querySelector('.ap-roles')!.className).toBe('ap-roles');
		expect(badges[0].title).toBe('Role: moderator');
	});

	it('stacks what does not fit behind the last badge that does, in each role\'s colors, and names them all', () => {
		// moderator 90px, then admin to 140: with three stacked behind the first (12px), 102px holds one badge.
		const badges = render({ roles: ROLES, overflow: 'stack' }, 102);
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
		const badges = render({ roles: ['moderator', 'admin', 'bot'], overflow: 'stack' }, 144);
		expect(badges.map((b) => [b.classList.contains('ap-role-stacked'), b.classList.contains('ap-role-behind')])).toEqual([[false, false], [true, false], [false, true]]);
	});

	it('shows every badge, unstacked, where the whole row fits', () => {
		const badges = render({ roles: ROLES, overflow: 'stack' }, 230);
		expect(badges.some((b) => b.classList.contains('ap-role-stacked') || b.classList.contains('ap-role-behind'))).toBe(false);
	});

	it('narrows the first badge to its minimum, then shows none and takes no room', () => {
		// The first badge (90px) and its stack (12px) want 102px; with 90 it narrows to 78, the room left beside the stack.
		const narrow = render({ roles: ROLES, overflow: 'stack' }, 90);
		expect(narrow[0].style.maxWidth).toBe('78px');
		unmount(instance!);
		const none = render({ roles: ROLES, overflow: 'stack' }, 30);
		expect(none.every((b) => b.classList.contains('ap-role-behind'))).toBe(true);
		expect(document.querySelector('.ap-roles')!.classList.contains('ap-roles-gone')).toBe(true);
	});
});
