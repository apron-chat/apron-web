import { HISTORY_RETENTION_KEY, loadHistoryRetention, saveHistoryRetention } from '$lib/ui/storage';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long history is kept on this device (`HistoryKeeper`): by when it was
 * logged, on servers whose positions are times. `ms` null keeps nothing;
 * undefined keeps everything loaded.
 */
export const RETENTIONS = [
	{ value: 'off', label: 'Don’t keep', ms: null },
	{ value: '1', label: 'A day', ms: DAY_MS },
	{ value: '7', label: 'A week', ms: 7 * DAY_MS },
	{ value: '30', label: '30 days', ms: 30 * DAY_MS },
	{ value: '365', label: 'A year', ms: 365 * DAY_MS },
	{ value: 'all', label: 'Everything loaded', ms: undefined }
] as const satisfies ReadonlyArray<{ value: string; label: string; ms: number | null | undefined }>;

export type Retention = (typeof RETENTIONS)[number]['value'];

export const DEFAULT_RETENTION: Retention = '30';

function known(value: unknown): value is Retention {
	return RETENTIONS.some((retention) => retention.value === value);
}

/** Keeping history on this device, shared by the page and Preferences: the retention chosen, and why keeping stopped. */
export class HistorySettings {
	retention = $state<Retention>(DEFAULT_RETENTION);
	/** Why history stopped being kept on this page, such as a full disk (`HistoryKeeper.failure`). */
	failure = $state<string | undefined>();

	load(): void {
		const saved = loadHistoryRetention();
		this.retention = known(saved) ? saved : DEFAULT_RETENTION;
	}

	/** Another tab changed `key` in storage: the retention chosen there holds here too. */
	storageChanged(key: string | null): void {
		if (key === HISTORY_RETENTION_KEY || key === null) this.load();
	}

	update(value: string): void {
		if (!known(value)) return;
		this.retention = value;
		saveHistoryRetention(value);
		// Kept for long, it's worth asking the browser not to clear it when space runs low.
		if (value === '365' || value === 'all') void globalThis.navigator?.storage?.persist?.().catch(() => false);
	}

	/** The retention in words, title-cased, as a title shows it: "30 Days", "Don’t Keep". */
	get title(): string {
		return RETENTIONS.find((retention) => retention.value === this.retention)!.label.replace(/(^|\s)\S/g, (first) => first.toUpperCase());
	}

	/** The retention in milliseconds, as `HistoryKeeper` takes it. */
	get ms(): number | null | undefined {
		return RETENTIONS.find((retention) => retention.value === this.retention)!.ms;
	}
}

export const historySettings = new HistorySettings();

/**
 * About how much this site keeps on this device, in words ("12 MB"), where the browser says: everything
 * of Apron's, history and the app's own files together.
 */
export async function storageUsed(storage: Pick<StorageManager, 'estimate'> | undefined = globalThis.navigator?.storage): Promise<string | undefined> {
	try {
		const usage = (await storage?.estimate())?.usage;
		if (usage === undefined) return undefined;
		if (usage < 1024 * 1024) return 'under 1 MB';
		const mb = usage / (1024 * 1024);
		return mb < 1024 ? `${Math.round(mb)} MB` : `${(mb / 1024).toFixed(1)} GB`;
	} catch {
		return undefined;
	}
}
