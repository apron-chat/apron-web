/**
 * The little of the passkey diagnostics that runs on every ceremony and sign-in, not only a failed one: which way a
 * credential was turned into JSON, and an error as the console shows it. The rest (`passkey-diagnostics`) decodes and
 * logs a failure, and is fetched only once one happens.
 */
import type { JsonObject } from './types';

export type PasskeyStage = 'waiting' | 'begin' | 'browser' | 'finish';

/** How a credential was turned into JSON (see `credentialJSON`): the browser's `toJSON`, or its fields read one by one, and why. */
export interface CredentialSource {
	source: 'toJSON' | 'fields';
	note?: string;
}

const sources = new WeakMap<JsonObject, CredentialSource>();

export function noteCredentialSource(json: JsonObject, source: CredentialSource): void {
	sources.set(json, source);
}

export function credentialSource(json: JsonObject): CredentialSource | undefined {
	return sources.get(json);
}

export function describeError(cause: unknown): { name: string; message: string; code?: number } {
	if (cause instanceof Error || (typeof DOMException !== 'undefined' && cause instanceof DOMException)) {
		const code = (cause as Error & { code?: unknown }).code;
		return { name: cause.name, message: cause.message, ...(typeof code === 'number' ? { code } : {}) };
	}
	return { name: typeof cause, message: String(cause) };
}
