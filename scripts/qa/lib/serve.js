import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
	'.wasm': 'application/wasm',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg'
};

/**
 * Serves a static build directory (adapter-static output: `/__preview` → `__preview.html`) on a free port.
 * Files are looked up on every request, so nothing is cached between builds; still, serve a snapshot, not
 * a directory you will rebuild, so a running comparison can't change under you.
 *
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export function serveDir(dir, { port = 0, host = '127.0.0.1' } = {}) {
	const root = resolve(dir);
	if (!existsSync(join(root, 'index.html')) && !existsSync(join(root, '__preview.html')))
		throw new Error(`${dir} doesn't look like a build (no index.html)`);
	const server = createServer((req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
		const file = resolveFile(root, path);
		if (!file) {
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('not found');
			return;
		}
		res.writeHead(200, {
			'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
			'content-length': statSync(file).size,
			'cache-control': 'no-store'
		});
		if (req.method === 'HEAD') res.end();
		else createReadStream(file).pipe(res);
	});
	return new Promise((ok, fail) => {
		server.once('error', fail);
		server.listen(port, host, () => {
			const address = /** @type {import('node:net').AddressInfo} */ (server.address());
			ok({
				url: `http://${host}:${address.port}`,
				port: address.port,
				close: () =>
					new Promise((done) => {
						server.close(() => done(undefined));
						server.closeAllConnections();
					})
			});
		});
	});
}

function resolveFile(root, path) {
	const clean = normalize(path).replace(/^([/\\])+/, '');
	for (const candidate of [clean, `${clean}.html`, join(clean, 'index.html')]) {
		const full = join(root, candidate);
		if (full !== root && !full.startsWith(root + sep)) return null; // outside the build
		try {
			if (statSync(full).isFile()) return full;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}
