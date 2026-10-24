/**
 * More ways to find what a person finds, for component tests in jsdom, beside `dom.ts`'s `byRole`: a form field by
 * its label, and an element by the text it shows.
 *
 *     byLabel('Email').value = 'ada@example.com';
 *     expect(byText('Showing 3 of 5: the most recently active')).not.toBeNull();
 */

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The words a label shows, less those of the field it wraps. */
function labelText(label: HTMLLabelElement): string {
	const copy = label.cloneNode(true) as HTMLLabelElement;
	for (const control of copy.querySelectorAll('input, textarea, select')) control.remove();
	return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * The form field labelled `name`: by `aria-label`, by the `<label>` that wraps it or names it with `for`, or by
 * `aria-labelledby`. Throws when there is none.
 */
export function byLabel<T extends Field = HTMLInputElement>(name: string, within: ParentNode = document): T {
	const fields = [...within.querySelectorAll<T>('input, textarea, select')];
	const found = fields.find((field) => {
		if (field.getAttribute('aria-label') === name) return true;
		const ids = field.getAttribute('aria-labelledby');
		if (ids && ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).join(' ') === name) return true;
		return [...(field.labels ?? [])].some((label) => labelText(label) === name);
	});
	if (!found) throw new Error(`no field labelled ${name}`);
	return found;
}

/** The innermost element whose text, trimmed, is exactly `text` (or matches it), or `null`. */
export function queryByText<T extends Element = HTMLElement>(text: string | RegExp, within: ParentNode = document.body): T | null {
	const matches = (element: Element) => {
		const shown = element.textContent?.trim() ?? '';
		return typeof text === 'string' ? shown === text : text.test(shown);
	};
	const all = [...within.querySelectorAll<T>('*')].filter(matches);
	return all.find((candidate) => !all.some((other) => other !== candidate && candidate.contains(other))) ?? null;
}

/** `queryByText`, throwing when nothing shows the text. */
export function byText<T extends Element = HTMLElement>(text: string | RegExp, within?: ParentNode): T {
	const element = queryByText<T>(text, within);
	if (!element) throw new Error(`nothing shows ${text}`);
	return element;
}

/** The element carrying `data-testid="id"`, or `null`: for checking the test-id contract, not for finding parts. */
export const byTestid = <T extends Element = HTMLElement>(id: string, within: ParentNode = document): T | null => within.querySelector<T>(`[data-testid="${id}"]`);
