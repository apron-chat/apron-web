import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { PreviewKnobs } from '../src/lib/preview/memory-server';
import { NARROW_MAX, NOW, VIEWPORTS } from '../scripts/qa/lib/helpers.js';
import { OFFSITE, mockServer, type MockOptions } from './mock-server';

export { expect };
export type { PreviewKnobs };

/** A frame the client sent, as the memory server recorded it. */
export type Frame = { id?: string | number; method?: string; params?: Record<string, any> };

/** Device presets for `test.use`: the QA suites' viewports, plus a 360px phone. */
export const DEVICES = {
	desktop: { viewport: VIEWPORTS.desktop },
	tablet: { viewport: VIEWPORTS.tablet },
	phone: { viewport: { width: VIEWPORTS.phone.width, height: VIEWPORTS.phone.height }, isMobile: true, hasTouch: true },
	phone360: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
	phone320: { viewport: { width: VIEWPORTS.narrow320.width, height: VIEWPORTS.narrow320.height }, isMobile: true, hasTouch: true }
} as const;

type Fixtures = {
	/** The memory server's knobs (`src/lib/preview/memory-server.ts`), set with `test.use({ knobs })`. */
	knobs: PreviewKnobs;
	preview: Preview;
};

export const test = base.extend<Fixtures>({
	knobs: [{}, { option: true }],
	preview: async ({ page, knobs }, use) => {
		await use(new Preview(page, knobs));
	}
});

/** The app on `/__preview`, and the in-memory server behind it. */
export class Preview {
	constructor(
		readonly page: Page,
		private readonly knobs: PreviewKnobs
	) {}

	/**
	 * Opens the preview (with `fragment`, e.g. `#room=engineering`) at the QA suites' fixed clock, with the
	 * knobs set, and waits until a timeline has messages.
	 */
	async open(fragment = ''): Promise<void> {
		const base = process.env.E2E_URL;
		if (!base) throw new Error('E2E_URL is unset: run through `npm run e2e` (global-setup serves the build).');
		await this.page.clock.setFixedTime(NOW);
		// Nothing leaves this machine (the preview has no backend; a link preview or image would be a leak).
		await this.page.route(OFFSITE, (route) => route.abort());
		await this.page.addInitScript((knobs) => {
			(window as unknown as { __APRON_PREVIEW__: unknown }).__APRON_PREVIEW__ = knobs;
		}, this.knobs);
		await this.page.goto(`${base}/__preview${fragment}`);
		await expect(this.page.getByTestId('message-list').locator('article[data-message-id]').first()).toBeVisible();
	}

	/**
	 * Opens the app's own route, `/`, against `mockServer` (a scripted backend offering guests, passkeys and
	 * email), and waits until it is connected as a guest.
	 */
	async openRoot(options: MockOptions = {}): Promise<void> {
		const base = process.env.E2E_URL;
		if (!base) throw new Error('E2E_URL is unset: run through `npm run e2e` (global-setup serves the build).');
		await this.page.clock.setFixedTime(NOW);
		await mockServer(this.page, options);
		await this.page.goto(`${base}/`);
		await expect(this.page.getByTestId('connection-status')).toHaveText('Connected');
	}

	/** Under 720px the app shows one pane at a time. */
	get narrow(): boolean {
		return (this.page.viewportSize()?.width ?? 1280) < NARROW_MAX;
	}

	composer(): Locator {
		return this.page.getByRole('textbox', { name: 'Message', exact: true });
	}

	/** The open pane's heading (the room's title; a thread's is `Room › Thread`). The first: messages have headings too. */
	heading(): Locator {
		return this.page.getByRole('main', { name: 'Conversation' }).getByRole('heading', { level: 1 }).first();
	}

	/** Every frame the client has sent so far. */
	frames(): Promise<Frame[]> {
		return this.page.evaluate(() => (window as unknown as { __apronPreview: { frames: Frame[] } }).__apronPreview.frames);
	}

	/** The `params` of each request of this method sent so far. */
	async sent(method: string): Promise<Record<string, any>[]> {
		return (await this.frames()).filter((f) => f.method === method).map((f) => f.params ?? {});
	}

	/** Waits for the client to send a request of this method that matches, and returns its params. */
	async waitForSent(method: string, match: (params: Record<string, any>) => boolean = () => true): Promise<Record<string, any>> {
		let found: Record<string, any> | undefined;
		await expect
			.poll(async () => {
				found = (await this.sent(method)).find(match);
				return Boolean(found);
			}, { message: `the client never sent a matching ${method}` })
			.toBe(true);
		return found!;
	}

	/** Someone else posts a message, delivered live. Returns its `message_id`. */
	post(room: string, from: string, body: string | Record<string, unknown>, fields: Record<string, unknown> = {}): Promise<string> {
		return this.page.evaluate(
			([room, from, body, fields]) => (window as any).__apronPreview.post(room, from, body, fields) as string,
			[room, from, body, fields] as const
		);
	}

	/**
	 * Someone posts a message with a live `terminal` or `append` embed (§4.8.3), as if their `PUT` just began (the
	 * memory server's `startLive`). Returns its `embed_id`, for `liveWrite` and `liveEnd`.
	 */
	startLive(room: string, from: string, kind: 'terminal' | 'append', fields: { title?: string; body?: Record<string, unknown> } = {}): Promise<string> {
		return this.page.evaluate(([room, from, kind, fields]) => (window as any).__apronPreview.startLive(room, from, kind, fields) as string, [room, from, kind, fields] as const);
	}

	/** Writes to a live text, as its `PUT` body would. */
	liveWrite(embedId: string, data: string): Promise<void> {
		return this.page.evaluate(([embedId, data]) => (window as any).__apronPreview.liveWrite(embedId, data), [embedId, data] as const);
	}

	/** How many times the client has read (`GET`) a live text's url. */
	liveReads(embedId: string): Promise<number> {
		return this.page.evaluate((embedId) => (window as any).__apronPreview.liveReads(embedId) as number, embedId);
	}

	/** Ends a live text: the snapshot that finishes it follows. */
	liveEnd(embedId: string): Promise<void> {
		return this.page.evaluate((embedId) => (window as any).__apronPreview.liveEnd(embedId), embedId);
	}

	/** Someone else sets their complete reaction set on a message (§4.7), delivered live. */
	reactAs(from: string, messageId: string, emojis: string[]): Promise<void> {
		return this.page.evaluate(([from, messageId, emojis]) => (window as any).__apronPreview.reactAs(from, messageId, emojis), [from, messageId, emojis] as const);
	}

	/**
	 * Someone else's shown status changes, as if now (§4.5.2): with capability `status`, `offline` brings a new `seen`,
	 * now or `recorded` (epoch milliseconds, as a server that records it coarsely might send).
	 */
	setPresence(userId: string, status: string, recorded?: number): Promise<void> {
		return this.page.evaluate(
			([userId, status, recorded]) => (window as any).__apronPreview.setPresence(userId, status, recorded === undefined ? undefined : String(recorded)),
			[userId, status, recorded] as const
		);
	}

	/** Shows the open room's member list, where it is folded away (a narrow screen, or closed). */
	async showMembers(): Promise<Locator> {
		const list = this.page.getByTestId('room-member-list');
		if (!(await list.isVisible())) await this.press(this.page.getByRole('button', { name: /member list/i }).first());
		await expect(list).toBeVisible();
		await expect(list.locator('li').first()).toBeVisible();
		return list;
	}

	/** Opens a member's profile card from the member list: a click on their row. */
	async memberProfile(list: Locator, userId: string): Promise<void> {
		await list.locator(`button[data-user-id="${userId}"]`).click();
	}

	/** A finger held on `locator`'s middle past a long press, then lifted. */
	async hold(locator: Locator): Promise<void> {
		const box = (await locator.boundingBox())!;
		const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		const cdp = await this.page.context().newCDPSession(this.page);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
		await this.page.waitForTimeout(700);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await cdp.detach();
	}

	/** Taps on a touch device, clicks otherwise. */
	async press(locator: Locator): Promise<void> {
		if (await this.page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await locator.tap();
		else await locator.click();
	}

	/** On a narrow viewport, goes back to the rooms pane unless it is showing. */
	async roomsPane(): Promise<void> {
		if (!this.narrow) return;
		const rooms = this.page.getByTestId('room-list');
		if (await rooms.isVisible()) return;
		await this.press(this.page.getByRole('button', { name: 'Back to rooms', exact: true }));
		await expect(rooms).toBeVisible();
	}

	/**
	 * Opens the connect screen as people reach it: the profile's Connect to a server… (on a narrow viewport, from
	 * the rooms pane). Only on `/` (`openRoot`): the preview has no connect screen.
	 */
	async openConnect(): Promise<void> {
		await this.roomsPane();
		await this.press(this.page.getByRole('button', { name: /^Your profile on/ }));
		await this.press(this.page.getByRole('dialog', { name: 'Edit profile', exact: true }).getByRole('button', { name: 'Connect to a server…', exact: true }));
		await expect(this.page.getByRole('form', { name: 'Sign in' })).toBeVisible();
	}

	/**
	 * Opens a room from the sidebar, by its row's `data-room`, as interop finds it. The open room is already open:
	 * picking it would fold its threads (on a phone, staying in the list), so on a phone the list's › goes back to it.
	 */
	async openRoom(id: string): Promise<void> {
		await this.roomsPane();
		const row = this.page.locator(`[data-testid="room-list"] button[data-room="${id}"]`);
		if ((await row.getAttribute('aria-current')) === 'page') {
			if (this.narrow) await this.press(this.page.getByRole('complementary', { name: 'Rooms' }).getByRole('button', { name: /^Back to / }));
			await expect(this.page.getByTestId('room-list')).toBeVisible({ visible: !this.narrow });
			return;
		}
		await this.press(row);
		await expect(this.page).toHaveURL(new RegExp(`[#&]room=${id}(&|$)`));
	}

	/** Opens one of a room's threads from the sidebar. */
	async openThread(id: string): Promise<void> {
		await this.roomsPane();
		await this.press(this.page.locator(`[data-testid="thread-list"] button[data-thread="${id}"]`));
		await expect(this.page).toHaveURL(new RegExp(`[#&]thread=${id}(&|$)`));
	}

	/** The message with this text in the open timeline. */
	message(text: string | RegExp): Locator {
		return this.page.getByTestId('message-list').locator('article[data-message-id]').filter({ hasText: text });
	}
}
