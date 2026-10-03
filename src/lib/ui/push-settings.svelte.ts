import type { PushRegistration } from '$lib/protocol/client';
import { saveEnabledPushIds } from './push-store';
import { loadWebPushAccounts, loadWebPushOwner, pushIdFor, saveWebPushEnabled, saveWebPushOwner, WEB_PUSH_ACCOUNTS_KEY, WEB_PUSH_OWNER_KEY, type WebPushOwner } from './storage';
import { pushHeldBy, webPushAccount, WebPushSync } from './web-push';

/** What push registers on: `ChatClient`. */
export interface PushSettingsClient {
	readonly url: string;
	setPushRegistration(registration: PushRegistration | undefined, userId?: string): void;
	setPushOff(url: string | undefined): void;
}

/** What `PushSettings` works with; tests stand in for them. */
export interface PushSettingsDeps {
	sync?: WebPushSync;
	/** Keeps the enabled accounts' `push_id`s for the service worker. */
	saveEnabledIds?: (ids: string[]) => Promise<void>;
	/** Sets the app badge (0 clears it). */
	setBadge?: (unread: number) => void;
	/** An account's `push_id`. */
	pushIdOf?: (account: string) => string;
}

/**
 * Push on or off per account (§4.7), and this browser's one subscription
 * between them: kept in storage, so every tab of the app follows the others
 * (`storageChanged`), and in IndexedDB for the service worker.
 */
export class PushSettings {
	/** The accounts (`webPushAccount`) push is on for here. */
	accounts = $state<string[]>([]);
	/** Whose the subscription is, as this and other tabs last made it. */
	owner = $state<WebPushOwner | undefined>();
	/** Why subscribing failed, until it works. */
	error = $state<string | undefined>();
	readonly sync: WebPushSync;
	private readonly saveEnabledIds: (ids: string[]) => Promise<void>;
	private readonly setBadge: (unread: number) => void;
	private readonly pushIdOf: (account: string) => string;

	constructor(deps: PushSettingsDeps = {}) {
		this.pushIdOf = deps.pushIdOf ?? pushIdFor;
		this.sync = deps.sync ?? new WebPushSync(undefined, this.pushIdOf);
		this.saveEnabledIds = deps.saveEnabledIds ?? saveEnabledPushIds;
		this.setBadge = deps.setBadge ?? (() => undefined);
	}

	/** Reads what this and other tabs saved. With no account on, the subscription goes (perhaps turned off while offline). */
	load(): void {
		this.accounts = loadWebPushAccounts();
		this.owner = loadWebPushOwner();
		void this.mirror();
		if (this.accounts.length) return;
		this.owner = undefined;
		saveWebPushOwner(undefined);
		void this.sync.release().catch(() => undefined);
	}

	/** Another tab changed this storage key. */
	storageChanged(key: string | null): void {
		if (key === WEB_PUSH_ACCOUNTS_KEY) this.accounts = loadWebPushAccounts();
		if (key === WEB_PUSH_OWNER_KEY) this.owner = loadWebPushOwner();
	}

	/** Push is on for this account here. */
	isOn(account: string | undefined): boolean {
		return account !== undefined && this.accounts.includes(account);
	}

	/** The server holding the subscription when it isn't this account's to use (`pushHeldBy`). */
	heldBy(account: string | undefined, key: string | undefined): string | undefined {
		return this.isOn(account) ? pushHeldBy(this.owner, account, key, this.accounts) : undefined;
	}

	/** The account's `push_id`. */
	pushId(account: string): string {
		return this.pushIdOf(account);
	}

	/**
	 * Subscribes with the server's key and registers for the account `userId`
	 * on `client`'s server; `current` says whether that is still the account
	 * signed in. Takes the subscription over from another account.
	 */
	async enable(client: PushSettingsClient, key: string, userId: string, wake: readonly string[] | undefined, current: () => boolean = () => true): Promise<void> {
		const account = webPushAccount(client.url, userId);
		try {
			client.setPushOff(undefined);
			if (!await this.sync.enable(client, key, userId, current, wake)) return;
			this.owner = { account, key };
			saveWebPushOwner(this.owner);
			this.error = undefined;
		} catch {
			this.error = 'This browser couldn’t subscribe to push notifications. Try again later.';
		}
	}

	/** Turns push on for the account signed in on `client` (`userId`), subscribing at once when it can. */
	async turnOn(client: PushSettingsClient, userId: string, key: string | undefined, wake: readonly string[] | undefined, ready: boolean): Promise<void> {
		this.error = undefined;
		this.accounts = saveWebPushEnabled(this.accounts, webPushAccount(client.url, userId), true);
		await this.mirror();
		if (key && ready) await this.enable(client, key, userId, wake);
	}

	/**
	 * Turns push off for `account`: unregisters it, and drops the
	 * subscription once no account here has push on; otherwise it is left
	 * for the others, whose tabs see it free up.
	 */
	async turnOff(client: PushSettingsClient, account: string): Promise<void> {
		this.error = undefined;
		this.accounts = saveWebPushEnabled(this.accounts, account, false);
		await this.mirror();
		const last = !this.accounts.length;
		if (this.owner?.account === account || last) {
			this.owner = undefined;
			saveWebPushOwner(undefined);
		}
		if (last) this.setBadge(0);
		await this.sync.disable(client, last).catch(() => undefined);
	}

	/**
	 * Signed out of `account`: push goes off for it here, so its previews stop
	 * showing even when the server couldn't be told (offline).
	 */
	async signedOut(client: PushSettingsClient, account: string | undefined): Promise<void> {
		if (account !== undefined && this.isOn(account)) await this.turnOff(client, account);
	}

	/**
	 * Push is off for the account signed in (or this tab doesn't hold it): no
	 * registration, and this browser's endpoint is unregistered after each
	 * `auth`, in case an earlier unregister was missed.
	 */
	async keepOff(client: PushSettingsClient): Promise<void> {
		await this.sync.disable(client, false);
		client.setPushOff(await this.sync.browser.endpoint().catch(() => undefined));
	}

	/** The enabled accounts' `push_id`s, for the service worker to drop pushes for any other. */
	private mirror(): Promise<void> {
		return this.saveEnabledIds(this.accounts.map((account) => this.pushIdOf(account)));
	}
}
