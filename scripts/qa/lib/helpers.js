/**
 * Helpers for writing suites: shared viewports, the preview's landmarks, and device-aware actions.
 *
 * Every helper takes a Playwright `Page` (or a `Locator`) and works out the device from what the runner
 * recorded for that page: on a touch viewport it taps instead of clicking, and sends with the Send button,
 * because Enter inserts a newline on phones.
 */

/** The fixed clock every scene runs at, so relative times and day dividers never move. */
export const NOW = new Date('2026-10-22T12:00:00Z');

/** Under this width the app shows one pane at a time (`NARROW_MAX` in src/lib/ui/breakpoints.ts). */
export const NARROW_MAX = 720;

/** Viewport presets. `deviceScaleFactor` defaults to 1; zoom200 emulates 200% zoom on a 1280×800 screen. */
export const VIEWPORTS = {
	desktop: { width: 1280, height: 800 },
	tablet: { width: 900, height: 800 },
	phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
	narrow320: { width: 320, height: 640, isMobile: true, hasTouch: true },
	zoom200: { width: 640, height: 400, deviceScaleFactor: 2 }
};

/** @typedef {{ viewport: string, theme: string, touch: boolean, narrow: boolean }} Device */

/** @type {WeakMap<object, Device>} */
const DEVICES = new WeakMap();

/** Records the device a page runs as (the runner calls this; ad-hoc scripts may too). */
export function setDevice(page, device) {
	DEVICES.set(page, device);
}

/** @returns {Device} */
export function device(page) {
	const known = DEVICES.get(page);
	if (known) return known;
	const width = page.viewportSize()?.width ?? 1280;
	return { viewport: 'unknown', theme: 'unknown', touch: false, narrow: width < NARROW_MAX };
}

export const isTouch = (page) => device(page).touch;
export const isNarrow = (page) => device(page).narrow;

/** Waits a fixed time. Waits are fixed, so a busy machine can flake a scene: rerun it before concluding. */
export const wait = (page, ms) => page.waitForTimeout(ms);

/** Opens the preview route (the app against the in-memory server) and waits for the timeline and fonts. */
export async function openPreview(page, baseUrl, { path = '/__preview', settle = 500, timeout = 10000 } = {}) {
	await page.goto(new URL(path, withSlash(baseUrl)).href);
	await page.waitForSelector('[data-testid=message-list] .ap-msg', { timeout });
	await fontsReady(page);
	await wait(page, settle);
}

export const fontsReady = (page) => page.evaluate(() => document.fonts.ready.then(() => undefined));

const withSlash = (url) => (url.endsWith('/') ? url : `${url}/`);

// Landmarks

export const timeline = (page) => page.locator('[data-testid=message-list]');
export const messages = (page) => timeline(page).locator('.ap-msg');
export const message = (page, i) => messages(page).nth(i);
export const lastMessage = (page) => messages(page).last();
export const composer = (page) => page.getByTestId('message-input');
export const roomList = (page) => page.getByTestId('room-list');
export const memberList = (page) => page.getByTestId('room-member-list');
export const openDialog = (page) => page.locator('dialog[open]').first();
/** The first button with this accessible name (exact for a string). */
export const button = (scope, name) => scope.getByRole('button', { name, exact: typeof name === 'string' }).first();

// Actions

/** Taps on a touch device, clicks otherwise. */
export async function press(locator, options = {}) {
	if (isTouch(locator.page())) await locator.tap(options);
	else await locator.click(options);
}

/** Presses the first button with this accessible name. */
export const pressButton = (page, name, options) => press(button(page, name), options);

/** Hovers message `i` (scrolled into view) and returns it. */
export async function hoverMessage(page, i) {
	const m = message(page, i);
	await m.scrollIntoViewIfNeeded();
	await wait(page, 150); // let the timeline settle, or the pointer lands on a neighbour
	await m.hover();
	return m;
}

/**
 * Reacts to a message through the emoji picker: opens it from the message's React button, searches for
 * `query` and picks the first match with Enter, then closes the picker. On touch the picker doesn't focus
 * its search (no keyboard pops up), so the search field is tapped first.
 */
export async function react(page, msg, query, { open = 1500, settle = 500 } = {}) {
	await msg.hover();
	await press(msg.getByRole('button', { name: 'React', exact: true }).first());
	await wait(page, open);
	if (isTouch(page)) await press(page.getByTestId('emoji-picker').getByPlaceholder('Search').first());
	await page.keyboard.insertText(query);
	await wait(page, settle);
	await page.keyboard.press('Enter');
	await wait(page, settle);
	await page.keyboard.press('Escape');
}

/** Focuses the composer and types `text` key by key (autocomplete reacts), without sending. */
export async function typeInComposer(page, text, options) {
	await press(composer(page));
	await page.keyboard.type(text, options);
}

/**
 * Sends a message: the text goes in as typed input (newlines as Shift+Enter), then the Send button is
 * pressed (tapped on touch, where Enter inserts a newline; and an open autocomplete can't take it). With
 * `enter`, a keyboard device sends with Enter instead.
 */
export async function send(page, text, { settle = 300, enter = false } = {}) {
	await press(composer(page));
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (i) await page.keyboard.press('Shift+Enter');
		await page.keyboard.insertText(lines[i]);
	}
	if (enter && !isTouch(page)) await page.keyboard.press('Enter');
	else await press(page.getByTestId('send-button'));
	await wait(page, settle);
}

/** Scrolls the timeline to `top`, `middle`, `bottom` or a pixel offset. */
export async function scrollTimeline(page, to, settle = 400) {
	await timeline(page).evaluate((el, to) => {
		el.scrollTop = to === 'top' ? 0 : to === 'middle' ? el.scrollHeight / 2 : to === 'bottom' ? el.scrollHeight : Number(to);
	}, to);
	await wait(page, settle);
}

/** On a narrow viewport, goes back to the rooms pane (where the sidebar and profile live), unless it's showing. */
export async function roomsPane(page) {
	if (!isNarrow(page) || (await roomList(page).isVisible())) return;
	await pressButton(page, 'Back to rooms');
	await wait(page, 300);
}

/**
 * Opens a room or thread from the sidebar (going to the rooms pane first on a narrow viewport). The open room is
 * already open: picking it would fold its threads (on a phone, staying in the list), so there the list's › goes back.
 */
export async function openRoom(page, name, settle = 500) {
	await roomsPane(page);
	const target = roomList(page).getByText(name, { exact: true }).first();
	const open = await target.evaluate((el) => el.closest('button[data-room]')?.getAttribute('aria-current') === 'page');
	if (open) {
		if (isNarrow(page)) await press(page.getByRole('complementary', { name: 'Rooms' }).getByRole('button', { name: /^Back to / }));
	} else await press(target);
	await wait(page, settle);
}

/** On a narrow viewport, opens the member list overlay. */
export async function showMembers(page) {
	if (!isNarrow(page)) return;
	await press(page.getByRole('button', { name: /member list/i }).first());
	await wait(page, 400);
}

/** Sets your display name from the profile popover (stays on the rooms pane on a narrow viewport). */
export async function rename(page, name) {
	await roomsPane(page);
	await press(page.getByRole('button', { name: /^Your profile/ }));
	await wait(page, 300);
	const field = page.locator('.ap-profile-pop input, [class*=profile] input[type=text], [class*=profile] input:not([type])').first();
	await field.fill(name);
	await field.press('Enter');
	await wait(page, 400);
	await page.keyboard.press('Escape');
	await wait(page, 200);
}

/** Creates a room from the Create room dialog. */
export async function createRoom(page, title, description = '') {
	await roomsPane(page);
	await pressButton(page, 'Create room');
	await wait(page, 300);
	const d = openDialog(page);
	await d.locator('input').first().fill(title);
	if (description) await d.locator('textarea').first().fill(description);
	await press(d.getByRole('button', { name: 'Create room' }));
	await wait(page, 600);
}

/** Moves the pointer out of the way so no hover state lingers into the screenshot. */
export async function parkPointer(page, settle = 200) {
	await page.mouse.move(1, 1);
	await wait(page, settle);
}

// Seed data

/** @type {WeakMap<object, { label: string, hits: number }[]>} */
const REWRITES = new WeakMap();

/**
 * Rewrites the served JS bundles in this browser context, e.g. to give a seeded person a long name, the
 * same way for both builds. `pairs` are `[RegExp, replacement string]`. The runner fails the scene if a
 * rewrite matched nothing, since a silent no-op would compare the unseeded app.
 */
export async function rewriteBundle(context, pairs, { url = /\/_app\/immutable\/.*\.js$/ } = {}) {
	const checks = pairs.map(([re]) => ({ label: String(re), hits: 0 }));
	REWRITES.set(context, [...(REWRITES.get(context) ?? []), ...checks]);
	await context.route(url, async (route) => {
		const response = await route.fetch();
		let body = await response.text();
		pairs.forEach(([re, replacement], i) => {
			body = body.replace(re, () => {
				checks[i].hits++;
				return replacement;
			});
		});
		await route.fulfill({ response, body });
	});
}

/** Throws if a `rewriteBundle` rewrite on this context never matched. */
export function checkRewrites(context) {
	const missed = (REWRITES.get(context) ?? []).filter((c) => !c.hits);
	if (missed.length) throw new Error(`bundle rewrite matched nothing: ${missed.map((c) => c.label).join(', ')}`);
}
