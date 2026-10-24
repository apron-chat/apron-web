// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmojiPopover from './EmojiPopover.svelte';
import PanelHandle from './PanelHandle.svelte';
import Popover from './Popover.svelte';
import SignInForm from './SignInForm.svelte';
import SystemLine from './SystemLine.svelte';
import * as dom from '$lib/test/dom';

/*
 * The attributes callers read off a design component's DOM, and the handlers they give it, each from a prop of its
 * own (the components take no attributes but those they declare). Test ids are in testids.svelte.test.ts.
 */

beforeEach(() => {
	// Popovers bind their height.
	dom.stubResizeObserver();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('SystemLine', () => {
	it('is a timeline row when asked, naming its log entry, with a tooltip', () => {
		dom.render(SystemLine, { text: 'Ada joined', timelineItem: true, logId: '1710000000001', title: 'Ada (@ada)' });
		const line = document.querySelector<HTMLElement>('.ap-msg-system')!;
		expect([line.hasAttribute('data-timeline-item'), line.dataset.logId, line.title]).toEqual([true, '1710000000001', 'Ada (@ada)']);
		dom.unmount();
		dom.render(SystemLine, { text: 'Ada joined' });
		expect(document.querySelector('.ap-msg-system')!.hasAttribute('data-timeline-item')).toBe(false);
	});
});

describe('SignInForm', () => {
	it('is a form named by its label, saying its phase, whose submit is the caller’s', () => {
		const onsubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
		dom.render(SignInForm, { schemes: ['guest'], scheme: 'guest', submit: 'Connect', label: 'Sign in', phase: 'ready', onsubmit });
		const form = document.querySelector('form')!;
		expect([form.getAttribute('aria-label'), form.dataset.phase]).toEqual(['Sign in', 'ready']);
		form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
		expect(onsubmit).toHaveBeenCalledOnce();
	});
});

describe('PanelHandle', () => {
	it('hands presses and keys to the caller, and toggles from a click with no pointer', () => {
		const onpointerdown = vi.fn();
		const onkeydown = vi.fn();
		const ontoggle = vi.fn();
		dom.render(PanelHandle, { side: 'left', onpointerdown, onkeydown, ontoggle });
		const handle = dom.button('Collapse sidebar');
		handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		dom.press(handle, 'ArrowLeft');
		handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect([onpointerdown.mock.calls.length, onkeydown.mock.calls.length, ontoggle.mock.calls.length]).toEqual([1, 1, 0]);
		handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
		expect(ontoggle).toHaveBeenCalledOnce();
	});
});

describe('Popover', () => {
	it('says its state, and hands its keys (captured or not) and focus leaving to the caller', () => {
		const onkeydown = vi.fn();
		const onkeydowncapture = vi.fn();
		const onfocusout = vi.fn();
		dom.render(Popover, { label: 'Hello', state: 'loading', onkeydown, onkeydowncapture, onfocusout, children: dom.html('<button>Inside</button>') });
		const box = dom.byRole('dialog', 'Hello');
		expect(box.dataset.state).toBe('loading');
		dom.press(dom.button('Inside'), 'Escape');
		box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
		expect([onkeydowncapture.mock.calls.length, onkeydown.mock.calls.length, onfocusout.mock.calls.length]).toEqual([1, 1, 1]);
	});
});

describe('EmojiPopover', () => {
	it('says how its picker stands in data-state', () => {
		dom.render(EmojiPopover, { status: 'loading' });
		expect(dom.byRole('dialog', 'Emoji picker').dataset.state).toBe('loading');
		dom.unmount();
		dom.render(EmojiPopover, {});
		expect(dom.byRole('dialog', 'Emoji picker').dataset.state).toBe('ready');
	});
});
