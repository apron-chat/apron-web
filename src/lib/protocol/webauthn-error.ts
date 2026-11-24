/**
 * Whether `cause` is a WebAuthn failure named `name`, such as
 * `NotAllowedError`, by its name alone: a password manager that runs the
 * ceremony in its place (Bitwarden, say) may throw a plain `Error` with the
 * name a browser's `DOMException` has, or one from another realm, which
 * `instanceof DOMException` misses.
 */
export function isWebAuthnError(cause: unknown, name: string): boolean {
	return typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === name;
}
