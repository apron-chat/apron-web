import { loadReadReceipts, READ_RECEIPTS_KEY, saveReadReceipts } from './storage';

/**
 * Read Receipts on this device (Preferences, where the server sets `ext.settings.read_receipts`): on by default.
 * Off, the page neither sends your read cursor in private rooms, where the server would show it to the other
 * members, nor shows theirs.
 */
export class ReceiptSettings {
	on = $state(true);

	load(): void {
		this.on = loadReadReceipts();
	}

	/** Another tab changed `key` in storage: what it chose holds here too. */
	storageChanged(key: string | null): void {
		if (key === READ_RECEIPTS_KEY || key === null) this.load();
	}

	set(on: boolean): void {
		this.on = on;
		saveReadReceipts(on);
	}
}

export const receiptSettings = new ReceiptSettings();
