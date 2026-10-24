/* How text from a server reads in a sentence. Shared by the client's errors (protocol/client-internals.ts) and the design system's notices (design/components/util.ts): both import it, neither from the other. */

/** A sentence as written, ending in `.` unless it ends in `.`, `!`, `?` or `…` already, such as a server's message. */
export function punctuated(text: string): string {
	const trimmed = text.trim();
	return !trimmed || /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
