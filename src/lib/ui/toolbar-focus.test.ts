// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { rovingToolbar } from './toolbar-focus';
import { press } from '$lib/test/dom';

/** A toolbar of two groups, as the formatting toolbar draws it. */
function toolbar(dir = 'ltr'): { bar: HTMLElement; buttons: HTMLButtonElement[]; detach: () => void } {
	document.body.innerHTML = `<div role="toolbar" dir="${dir}"><div role="group"><button>B</button><button>I</button></div><span role="separator"></span><div role="group"><button>Code</button></div></div><button>after</button>`;
	const bar = document.querySelector<HTMLElement>('[role="toolbar"]')!;
	const detach = rovingToolbar(bar)!;
	return { bar, buttons: [...bar.querySelectorAll('button')], detach };
}

const stops = (buttons: HTMLButtonElement[]) => buttons.map((button) => button.tabIndex);

afterEach(() => (document.body.innerHTML = ''));

describe('rovingToolbar', () => {
	it('is one Tab stop, which follows the focus', () => {
		const { buttons } = toolbar();
		expect(stops(buttons)).toEqual([0, -1, -1]);
		buttons[2].focus();
		expect(stops(buttons)).toEqual([-1, -1, 0]);
	});

	it('moves with the arrows across its groups, wrapping, and to its ends with Home and End', () => {
		const { buttons } = toolbar();
		buttons[0].focus();
		expect(press(buttons[0], 'ArrowRight')).toBe(false);
		expect(document.activeElement).toBe(buttons[1]);
		press(buttons[1], 'ArrowRight');
		expect(document.activeElement).toBe(buttons[2]);
		press(buttons[2], 'ArrowRight');
		expect(document.activeElement).toBe(buttons[0]);
		press(buttons[0], 'ArrowLeft');
		expect(document.activeElement).toBe(buttons[2]);
		press(buttons[2], 'Home');
		expect(document.activeElement).toBe(buttons[0]);
		press(buttons[0], 'End');
		expect(document.activeElement).toBe(buttons[2]);
		// Up and Down, and the arrows with a modifier (selecting, in the field's shortcuts), are left alone.
		expect(press(buttons[2], 'ArrowDown')).toBe(true);
		expect(press(buttons[2], 'ArrowLeft', { shiftKey: true })).toBe(true);
	});

	it('reverses the arrows right to left', () => {
		const { buttons } = toolbar('rtl');
		buttons[0].focus();
		press(buttons[0], 'ArrowLeft');
		expect(document.activeElement).toBe(buttons[1]);
	});

	it('skips disabled buttons, and stops listening once detached', () => {
		const { buttons, detach } = toolbar();
		buttons[1].disabled = true;
		buttons[0].focus();
		press(buttons[0], 'ArrowRight');
		expect(document.activeElement).toBe(buttons[2]);
		detach();
		expect(press(buttons[2], 'ArrowRight')).toBe(true);
	});

	it('leaves it all to the browser where focusgroup is native', () => {
		Object.defineProperty(HTMLElement.prototype, 'focusGroup', { value: '', configurable: true });
		try {
			document.body.innerHTML = '<div role="toolbar"><button>B</button><button>I</button></div>';
			expect(rovingToolbar(document.querySelector('[role="toolbar"]')!)).toBeUndefined();
			expect(document.querySelector('button')!.hasAttribute('tabindex')).toBe(false);
		} finally {
			delete (HTMLElement.prototype as { focusGroup?: unknown }).focusGroup;
		}
	});
});
