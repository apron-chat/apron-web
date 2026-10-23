// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import AddMemberForm from './AddMemberForm.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(AddMemberForm, props);
	return document.querySelector<HTMLFormElement>('form')!;
}

const submit = (form: HTMLFormElement) => form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));

describe('AddMemberForm', () => {
	it('sends what was typed, suggests people by user_id, and waits while busy', () => {
		const onadd = vi.fn();
		const form = render({ id: 'add', value: '@cy', candidates: [{ user_id: 'cy', name: 'Cy' }], onadd });
		expect([form.id, form.classList.contains('ap-memberlist-add'), form.getAttribute('aria-label')]).toEqual(['add', true, 'Add a member']);
		expect(form.querySelector('option')?.textContent).toBe('Cy (@cy)');
		submit(form);
		expect(onadd).toHaveBeenCalledWith('@cy');
		dom.unmount();
		const busy = render({ value: '@cy', busy: true });
		expect([busy.querySelector('input')!.disabled, busy.querySelector<HTMLButtonElement>('button')!.disabled]).toEqual([true, true]);
		dom.unmount();
		expect(render({ value: '  ' }).querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
	});

	it('focuses its field when asked, and asks to be dismissed on Escape', () => {
		const ondismiss = vi.fn();
		const form = render({ ondismiss });
		dom.exportsOf<{ focus(): void }>().focus();
		const field = form.querySelector('input')!;
		expect(document.activeElement).toBe(field);
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(ondismiss).toHaveBeenCalledOnce();
	});

	it('runs the caller’s submit first, which can take it over with preventDefault()', () => {
		const onadd = vi.fn();
		const form = render({ value: 'cy', class: 'mine', onadd, onsubmit: (event: SubmitEvent) => event.preventDefault() });
		expect(form.classList.contains('mine')).toBe(true);
		submit(form);
		expect(onadd).not.toHaveBeenCalled();
	});
});
