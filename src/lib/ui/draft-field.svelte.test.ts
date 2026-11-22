// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { MentionPerson } from '$lib/protocol/markdown';
import { DraftField } from './draft-field.svelte';
import { commandCompletion, commandInfo } from './command-autocomplete';
import type { OfferedCommand } from './command-query';

/** A field for `@` mentions of Alan, whose picker shows only while `shown` says so (its code loads on demand). */
function field(shown: { value: boolean }, options: { newlineOnEnter?: boolean; outsiders?: MentionPerson[]; people?: MentionPerson[]; commands?: () => readonly OfferedCommand[] | undefined; oncommand?: () => void; onbrowse?: () => void } = {}) {
	let value = $state('');
	let mentions = $state<string[]>([]);
	const submit = vi.fn();
	/** The caller's own keys (`DraftHost.key`): it takes none here. */
	const key = vi.fn((_event: KeyboardEvent) => false);
	let draft!: DraftField;
	const stop = $effect.root(() => {
		draft = new DraftField({
			get value() { return value; },
			set value(text) { value = text; },
			get mentions() { return mentions; },
			set mentions(ids) { mentions = ids; },
			people: options.people ?? [{ id: 'alan', name: 'Alan Turing' }],
			outsiders: options.outsiders,
			rooms: [],
			disabled: false,
			submit,
			key: (event) => key(event),
			get pickerShown() { return shown.value; },
			newlineOnEnter: options.newlineOnEnter,
			// A field offers commands where it is told what to do as one starts.
			commands: options.oncommand ? {
				get ready() { return options.commands?.() !== undefined; },
				complete: (found) => commandCompletion(options.commands?.() ?? [], found),
				describe: (text) => commandInfo(options.commands?.() ?? [], text),
				started: () => options.oncommand?.(),
				browse: () => options.onbrowse?.()
			} : undefined
		}, 'test-suggestions');
	});
	const element = document.createElement('div');
	element.contentEditable = 'true';
	element.tabIndex = 0;
	document.body.append(element);
	draft.element = element;
	flushSync();
	// It reads a query only while it has the keyboard.
	element.focus();
	/** Types `text` at the end, the caret after it. */
	const type = (text: string) => {
		element.append(text);
		const range = document.createRange();
		range.setStart(element, element.childNodes.length);
		document.getSelection()!.removeAllRanges();
		document.getSelection()!.addRange(range);
		draft.input(new InputEvent('input', { bubbles: true }));
		flushSync();
	};
	const enter = () => {
		draft.keydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
		flushSync();
	};
	/** The browser's own lines, as Chrome writes them into a `contenteditable` (one `<div>` per line after the first), read in. */
	const lines = (html: string) => {
		element.innerHTML = html;
		draft.input(new InputEvent('input', { bubbles: true }));
		flushSync();
	};
	/** The selection, as the draft's positions. */
	const selected = () => {
		const range = document.getSelection()!.getRangeAt(0);
		const at = (node: Node, offset: number) => {
			const before = document.createRange();
			before.setStart(element, 0);
			before.setEnd(node, offset);
			// A chip counts as its `@user_id`, as the draft does.
			const holder = document.createElement('div');
			holder.append(before.cloneContents());
			for (const chip of holder.querySelectorAll<HTMLElement>('[data-user-id]')) chip.textContent = `@${chip.dataset.userId}`;
			return holder.textContent!.length;
		};
		return [at(range.startContainer, range.startOffset), at(range.endContainer, range.endOffset)];
	};
	return { draft, submit, key, type, enter, lines, selected, element, value: () => value, mentions: () => mentions, done: () => { stop(); element.remove(); } };
}

describe('DraftField', () => {
	it('asks the caller only about keys that type nothing, outside a composition and a picker, before Enter sends', () => {
		const shown = $state({ value: true });
		const f = field(shown);
		const press = (init: KeyboardEventInit) => f.draft.keydown(new KeyboardEvent('keydown', { cancelable: true, ...init }));
		press({ key: 'a' });
		press({ key: 'ArrowUp', isComposing: true });
		expect(f.key).not.toHaveBeenCalled();
		press({ key: 'ArrowUp' });
		expect(f.key).toHaveBeenCalledTimes(1);
		// Taken by the caller, Enter doesn't send.
		f.key.mockReturnValueOnce(true);
		f.enter();
		expect(f.submit).not.toHaveBeenCalled();
		f.enter();
		expect(f.submit).toHaveBeenCalledOnce();
		// A picker open takes its keys first.
		f.key.mockClear();
		f.type('@al');
		press({ key: 'Escape' });
		expect(f.key).not.toHaveBeenCalled();
		f.done();
	});

	it('looks for a query only near an `@`, `#` or `:`, however far along the line, and closes it once past', () => {
		const f = field({ value: true });
		f.type('x'.repeat(80));
		expect(f.draft.pickerOpen).toBe(false);
		f.type(' @al');
		expect(f.draft.pickerOpen).toBe(true);
		// Moving off the query with a key that types nothing reads it again (at `keyup`).
		f.type('\nplain');
		f.draft.keyup(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
		expect(f.draft.pickerOpen).toBe(false);
		f.done();
	});

	it('sends nothing on the Enter that commits a composition, as Safari sends it after `compositionend`', () => {
		const f = field({ value: true });
		const press = (init: KeyboardEventInit) => {
			const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
			f.draft.keydown(event);
			return event;
		};
		expect(press({ key: 'Enter', isComposing: true }).defaultPrevented).toBe(false);
		// Safari: no longer composing, but the input method's key code.
		expect(press({ key: 'Enter', keyCode: 229 }).defaultPrevented).toBe(false);
		expect(f.submit).not.toHaveBeenCalled();
		// Nor takes a suggestion in the picker.
		f.type('@al');
		expect(press({ key: 'Enter', keyCode: 229 }).defaultPrevented).toBe(false);
		expect(f.mentions()).toEqual([]);
		expect(f.key).not.toHaveBeenCalled();
		f.done();
	});

	it('takes no keys for a picker that isn’t drawn yet: Enter sends, and the field names no picker', () => {
		const shown = $state({ value: false });
		const f = field(shown);
		f.type('hi @al');
		expect(f.draft.pickerOpen).toBe(true);
		expect(f.draft.aria['aria-controls']).toBeUndefined();
		f.enter();
		expect(f.submit).toHaveBeenCalledOnce();
		expect(f.mentions()).toEqual([]);
		f.done();
	});

	it('keeps a blank line typed between lines, as Chrome draws it (`<div><br></div>`)', () => {
		const f = field({ value: false });
		f.lines('one<div>two</div><div><br></div><div>three</div>');
		expect(f.value()).toBe('one\ntwo\n\nthree');
		f.lines('one<div><br></div><div><br></div><div>two</div>');
		expect(f.value()).toBe('one\n\n\ntwo');
		f.lines('<div><br></div><div>one</div>');
		expect(f.value()).toBe('\none');
		// Ending the field, an empty line is where the caret sits: the line break before it, kept once.
		f.lines('one<div><br></div>');
		expect(f.value()).toBe('one\n');
		f.lines('one<div>two</div>');
		expect(f.value()).toBe('one\ntwo');
		f.done();
	});

	it('once the picker is drawn, Enter picks from it rather than sending', () => {
		const shown = $state({ value: false });
		const f = field(shown);
		f.type('hi @al');
		shown.value = true;
		flushSync();
		expect(f.draft.aria['aria-controls']).toBe('test-suggestions');
		f.enter();
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.mentions()).toEqual(['alan']);
		f.done();
	});

	it('with `newlineOnEnter`, Enter starts a line and Ctrl+Enter or ⌘+Enter sends', () => {
		const f = field({ value: true }, { newlineOnEnter: true });
		document.execCommand = vi.fn(() => true);
		f.type('one');
		f.enter();
		expect(f.submit).not.toHaveBeenCalled();
		expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '\n');
		f.draft.keydown(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true }));
		f.draft.keydown(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, cancelable: true }));
		expect(f.submit).toHaveBeenCalledTimes(2);
		// @ts-expect-error: jsdom has no editing commands; put it back as it was.
		delete document.execCommand;
		f.done();
	});

	it('carries a list on to a new line: a task unticked, ready to type', () => {
		const f = field({ value: true }, { newlineOnEnter: true });
		document.execCommand = vi.fn(() => true);
		f.type('- [x] Foo');
		f.enter();
		// Typed as the browser types, so its Undo takes it back (jsdom has no editing commands to do it).
		expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '\n- [ ] ');
		// @ts-expect-error: jsdom has no editing commands; put it back as it was.
		delete document.execCommand;
		f.done();
	});

	it('writes a checklist item typed short (`-[] `) out in full as its space is typed', () => {
		const f = field({ value: true });
		document.execCommand = vi.fn(() => true);
		f.type('-[] ');
		f.draft.input(new InputEvent('input', { data: ' ', inputType: 'insertText' }));
		// What differs from the shorthand is selected and typed over: `[] ` becomes ` [ ] ` after the `-`.
		expect(document.execCommand).toHaveBeenCalledWith('insertText', false, ' [ ] ');
		expect(document.getSelection()!.toString()).toBe('[] ');
		// @ts-expect-error: jsdom has no editing commands; put it back as it was.
		delete document.execCommand;
		f.done();
	});

	it('draws a checklist item as its checkbox, ticks it on a click, and copies it as its Markdown', () => {
		const f = field({ value: true });
		f.type('Plan:\n- [ ] Ship');
		const box = () => f.element.querySelector<HTMLElement>('[data-task]')!;
		expect(box().getAttribute('aria-label')).toBe('Checklist item');
		// Its ring, in the span a rendered check comes in.
		expect(box().classList.contains('ap-task-box')).toBe(true);
		const ring = box().querySelector('.ap-task-chip')!;
		expect(ring).not.toBeNull();
		// A click on the ring itself ticks it.
		const click = new MouseEvent('click', { cancelable: true });
		Object.defineProperty(click, 'target', { value: ring });
		f.draft.click(click);
		expect(f.value()).toBe('Plan:\n- [x] Ship');
		expect(box().getAttribute('aria-label')).toBe('Checklist item, done');
		// Copying it all gives its Markdown.
		const range = document.createRange();
		range.selectNodeContents(f.element);
		document.getSelection()!.removeAllRanges();
		document.getSelection()!.addRange(range);
		const data = new Map<string, string>();
		const copy = Object.assign(new Event('copy', { cancelable: true }), { clipboardData: { setData: (type: string, text: string) => data.set(type, text) } }) as unknown as ClipboardEvent;
		f.draft.copy(copy);
		expect(copy.defaultPrevented).toBe(true);
		expect(data.get('text/plain')).toBe('Plan:\n- [x] Ship');
		f.done();
	});

	it('applies a formatting change around the selection, keeping chips, and selects what it returns', () => {
		const f = field({ value: true });
		f.type('ask @alan \nthen go');
		expect(f.element.querySelector('[data-user-id="alan"]')).not.toBeNull();
		// Select from inside the first line to inside the second, as a reader would drag.
		const text = f.element.childNodes;
		document.getSelection()!.setBaseAndExtent(text[0], 1, text[text.length - 1], 3);
		const applied = f.draft.apply((edit) => {
			expect(edit).toEqual({ text: 'ask @alan \nthen go', start: 1, end: 12 });
			return { text: '> ask @alan \n> then go', start: 0, end: 22 };
		});
		flushSync();
		expect(applied).toBe(true);
		expect(f.value()).toBe('> ask @alan \n> then go');
		expect(f.element.querySelector('[data-user-id="alan"]')).not.toBeNull();
		expect(f.selected()).toEqual([0, 22]);
		// A change with nothing to do changes nothing.
		expect(f.draft.apply(() => undefined)).toBe(false);
		f.done();
	});

	it('applies a change to the selection the field had when it lost focus, as from a toolbar reached with Tab', () => {
		const f = field({ value: true });
		f.type('bold me');
		document.getSelection()!.setBaseAndExtent(f.element.firstChild!, 0, f.element.firstChild!, 4);
		f.draft.blur();
		document.getSelection()!.removeAllRanges();
		f.draft.apply((edit) => ({ text: `**${edit.text.slice(edit.start, edit.end)}**${edit.text.slice(edit.end)}`, start: 2, end: 6 }));
		flushSync();
		expect(f.value()).toBe('**bold** me');
		expect(f.selected()).toEqual([2, 6]);
		f.done();
	});

	it('offers people who aren’t here after those who are, and only once something is typed', () => {
		const outsiders: MentionPerson[] = [{ id: 'ada', name: 'Ada Outside', outside: true }, { id: 'grace', name: 'Grace', outside: true }];
		const { draft, type, done } = field({ value: true }, { outsiders });
		type('@');
		expect(draft.matches.map((match) => ('id' in match ? match.id : match.role))).toEqual(['alan']);
		type('a');
		expect(draft.matches.map((match) => ('id' in match ? match.id : match.role))).toEqual(['alan', 'ada']);
		done();
	});

	it('offers a role held only outside after everyone and everything here, in what room is left', () => {
		const people: MentionPerson[] = Array.from({ length: 9 }, (_, n) => ({ id: `a${n}`, name: `Ann ${n}` }));
		const outsiders: MentionPerson[] = [{ id: 'ada', name: 'Ada', roles: ['admin'], outside: true }];
		const { draft, type, done } = field({ value: true }, { people, outsiders });
		type('@a');
		const ids = draft.matches.map((match) => ('id' in match ? match.id : `&${match.role}`));
		// Eight places, all for the people here: neither Ada nor her role takes one from them.
		expect(ids).toEqual(people.slice(0, 8).map((person) => person.id));
		done();
	});
});

describe('DraftField: commands', () => {
	const COMMANDS: OfferedCommand[] = [
		{ name: 'emoji add', description: 'Add a custom emoji', hint: ':name:' },
		{ name: 'emoji remove', description: 'Remove a custom emoji', hint: ':name:' },
		{ name: 'help', description: 'List the commands that you can use' },
		{ name: 'nick', description: 'Change your display name', hint: '<name>', own: true }
	];
	const tab = (f: ReturnType<typeof field>) => {
		f.draft.keydown(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
		flushSync();
	};
	/** The commands listed, without the Browse all commands row that ends every list. */
	const listed = (f: ReturnType<typeof field>) => (f.draft.commandPickerOpen ? f.draft.commandMatches.filter((match) => !match.browse).map((match) => match.name) : undefined);

	it('offers the first word of each command, puts in `/name ` as one is picked, and then its forms', () => {
		const oncommand = vi.fn();
		const f = field({ value: true }, { commands: () => COMMANDS, oncommand });
		f.type('/');
		expect(oncommand).toHaveBeenCalledOnce();
		expect(listed(f)).toEqual(['emoji', 'help', 'nick']);
		f.type('em');
		expect(listed(f)).toEqual(['emoji']);
		tab(f);
		expect(f.value()).toBe('/emoji ');
		expect(listed(f)).toEqual(['emoji add', 'emoji remove']);
		f.type('r');
		f.enter();
		expect(f.value()).toBe('/emoji remove ');
		// Named in full, its arguments next: its entry alone shows, which takes no keys.
		expect(f.draft.commandInfo?.name).toBe('emoji remove');
		expect(f.draft.commandMatches).toEqual([]);
		expect(f.submit).not.toHaveBeenCalled();
		// Once a command is started, it isn't asked for again while it is typed.
		expect(oncommand).toHaveBeenCalledOnce();
		f.done();
	});

	it('leaves Enter to send a command named in full, or with nothing typed of the word', () => {
		const f = field({ value: true }, { commands: () => COMMANDS, oncommand: () => {} });
		f.type('/help');
		expect(listed(f)).toEqual(['help']);
		f.enter();
		expect(f.submit).toHaveBeenCalledOnce();
		f.done();
		const g = field({ value: true }, { commands: () => COMMANDS, oncommand: () => {} });
		g.type('/he');
		g.enter();
		expect(g.value()).toBe('/help ');
		expect(g.submit).not.toHaveBeenCalled();
		g.enter();
		expect(g.submit).toHaveBeenCalledOnce();
		g.done();
	});

	it('waits for the commands before it shows any, and offers none where commands aren’t (the message editor)', () => {
		let commands = $state<readonly OfferedCommand[] | undefined>();
		const oncommand = vi.fn();
		const f = field({ value: true }, { commands: () => commands, oncommand });
		f.type('/ni');
		expect(oncommand).toHaveBeenCalledOnce();
		expect(f.draft.commandPickerOpen).toBe(false);
		commands = COMMANDS;
		flushSync();
		expect(listed(f)).toEqual(['nick']);
		f.done();
		const editor = field({ value: true }, { commands: () => COMMANDS });
		editor.type('/ni');
		expect(editor.draft.commandPickerOpen).toBe(false);
		editor.done();
	});

	it('ends with Browse all commands where offered, which Enter takes, leaving the draft as it is', () => {
		const onbrowse = vi.fn();
		const f = field({ value: true }, { commands: () => COMMANDS, oncommand: () => {}, onbrowse });
		f.type('/emoji r');
		expect(listed(f)).toEqual(['emoji remove']);
		expect(f.draft.commandMatches.at(-1)?.browse).toBe(true);
		f.draft.keydown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
		flushSync();
		f.enter();
		expect(onbrowse).toHaveBeenCalledOnce();
		expect(f.submit).not.toHaveBeenCalled();
		expect(f.draft.commandPickerOpen).toBe(false);
		expect(f.value()).toBe('/emoji r');
		// A command used from there: `/name ` in place of what was typed of the command, its forms next.
		f.draft.putCommand('emoji');
		expect(f.value()).toBe('/emoji ');
		expect(listed(f)).toEqual(['emoji add', 'emoji remove']);
		f.done();
		// Nothing typed that matches: the row is all there is, and Enter sends what was typed, as a command no one lists.
		const g = field({ value: true }, { commands: () => COMMANDS, oncommand: () => {}, onbrowse });
		g.type('/zap');
		expect(listed(g)).toEqual([]);
		expect(g.draft.commandMatches).toHaveLength(1);
		g.enter();
		expect(g.submit).toHaveBeenCalledOnce();
		expect(onbrowse).toHaveBeenCalledOnce();
		// Used with no Browse first: the draft's first word, a command's, goes; text that's no command stays after it.
		g.draft.putCommand('help');
		expect(g.value()).toBe('/help ');
		g.lines('hello there');
		g.draft.putCommand('nick');
		expect(g.value()).toBe('/nick hello there');
		g.done();
	});

	it('keeps the entry of the command named shown while its arguments are typed, which Enter sends and Escape puts away', () => {
		const f = field({ value: true }, { commands: () => COMMANDS, oncommand: () => {} });
		f.type('/nick');
		expect(listed(f)).toEqual(['nick']);
		f.type(' Ada');
		expect(f.draft.commandInfo).toEqual({ name: 'nick', hint: '<name>', description: 'Change your display name' });
		// No list: the card alone.
		expect(f.draft.commandPickerOpen).toBe(false);
		// Tab and the arrows are the field's; Enter sends.
		const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
		f.draft.keydown(tab);
		expect(tab.defaultPrevented).toBe(false);
		f.type(' Lovelace');
		expect(f.draft.commandInfo?.name).toBe('nick');
		f.enter();
		expect(f.submit).toHaveBeenCalledOnce();
		// Escape puts it away for that name, however the arguments go on.
		f.draft.keydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
		flushSync();
		expect(f.draft.commandInfo).toBeUndefined();
		f.type(' more');
		expect(f.draft.commandInfo).toBeUndefined();
		f.done();
		// A name that names nothing: the list says so while it is typed, and nothing shows past it.
		const g = field({ value: true }, { commands: () => COMMANDS, oncommand: () => {} });
		g.type('/nope');
		expect(listed(g)).toEqual([]);
		expect(g.draft.commandPickerOpen).toBe(true);
		g.type(' arg');
		expect(g.draft.commandPickerOpen).toBe(false);
		expect(g.draft.commandInfo).toBeUndefined();
		g.done();
	});

	it('lists the commands anew as they change, for the same command typed, and names them anew in its entry', () => {
		let commands = $state<readonly OfferedCommand[]>([{ name: 'help', description: 'Help' }]);
		const f = field({ value: true }, { commands: () => commands, oncommand: () => {} });
		f.type('/he');
		expect(listed(f)).toEqual(['help']);
		commands = [{ name: 'help', description: 'Help' }, { name: 'hello', description: 'Say hello' }];
		flushSync();
		expect(listed(f)).toEqual(['help', 'hello']);
		f.type('llo there');
		expect(f.draft.commandInfo?.description).toBe('Say hello');
		commands = [{ name: 'hello', description: 'Wave' }];
		flushSync();
		expect(f.draft.commandInfo?.description).toBe('Wave');
		f.done();
	});
});

