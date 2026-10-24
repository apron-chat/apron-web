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

	it('takes a class beside its own, and its submit stays its own', () => {
		const onadd = vi.fn();
		const form = render({ value: 'cy', class: 'mine', onadd });
		expect([form.classList.contains('ap-memberlist-add'), form.classList.contains('mine')]).toEqual([true, true]);
		const event = new SubmitEvent('submit', { cancelable: true });
		form.dispatchEvent(event);
		expect([event.defaultPrevented, onadd.mock.calls]).toEqual([true, [['cy']]]);
	});
});
