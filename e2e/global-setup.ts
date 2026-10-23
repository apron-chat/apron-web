import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { serveDir } from '../scripts/qa/lib/serve.js';
import { SEEN_DIR } from './contract';

/**
 * Serves the build (`E2E_BUILD`, default `build/`) on a free port for the whole run, unless `E2E_URL` names
 * one already served. Workers read the URL from `E2E_URL` (and the directory from `E2E_BUILD_DIR`), which they inherit.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
	// What the contract scenes saw last time mustn't count for this run.
	rmSync(SEEN_DIR, { recursive: true, force: true });
	if (process.env.E2E_URL) return undefined;
	const dir = resolve(import.meta.dirname, '..', process.env.E2E_BUILD ?? 'build');
	let server;
	try {
		server = await serveDir(dir);
	} catch (cause) {
		throw new Error(`e2e: can't serve ${dir} (${cause instanceof Error ? cause.message : cause}). Run \`npm run e2e\`, which builds first, or set E2E_BUILD.`);
	}
	process.env.E2E_URL = server.url;
	process.env.E2E_BUILD_DIR = dir;
	return server.close;
}
