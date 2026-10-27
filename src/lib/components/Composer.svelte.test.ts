// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Composer from './Composer.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	const onsend = vi.fn();
	dom.render(Composer, { value: 'Back in a bit', placeholder: 'Message General', disabled: false, canUpload: false, people: [], oninput: vi.fn(), onsend, onfiles: vi.fn(), onunstage: vi.fn(), onrename: vi.fn(), oncancelreply: vi.fn(), ...props } as never);
	flushSync();
	return { onsend, field: document.querySelector<HTMLElement>('[data-testid="message-input"]')!, send: document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')! };
}

describe('Composer', () => {
	it('holding Send takes typing but sends nothing: Send is off, and Enter keeps the draft', () => {
		const { onsend, field, send } = render({ holdSend: true });
		expect(field.getAttribute('contenteditable')).not.toBe('false');
		expect(send.disabled).toBe(true);
		dom.press(field, 'Enter');
		expect(onsend).not.toHaveBeenCalled();
		expect(field.textContent).toBe('Back in a bit');
		dom.unmount();

		// Once it's let go, the same draft sends.
		const live = render({ holdSend: false });
		expect(live.send.disabled).toBe(false);
		dom.press(live.field, 'Enter');
		expect(live.onsend).toHaveBeenCalledOnce();
	});
});
