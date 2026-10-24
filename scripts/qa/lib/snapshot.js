import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

/** The repository root (a worktree's own root inside a worktree). */
export const repoRoot = (cwd = process.cwd()) => git(cwd, 'rev-parse', '--show-toplevel');

/** `<repo>/.qa`, where every snapshot, run and report goes (gitignored). */
export const qaDir = (repo) => join(repo, '.qa');

/**
 * Builds a git ref in its own snapshot, `.qa/snap/<sha>`: the commit's files (`git archive`), its
 * protocol submodule, and node_modules (a symlink to the checkout's, or `npm ci` with `install`), then
 * `npm run build`. A finished snapshot of the same commit is reused unless `rebuild`.
 *
 * @returns {Promise<Snapshot>}
 */
export async function snapshotRef(repo, ref, { rebuild = false, install = false, log = console.log } = {}) {
	const sha = git(repo, 'rev-parse', '--verify', `${ref}^{commit}`);
	const short = sha.slice(0, 12);
	const dir = join(qaDir(repo), 'snap', short);
	const label = ref === short || sha.startsWith(ref) ? short : `${ref} (${short})`;
	const marker = join(dir, '.qa-built');
	if (!rebuild && existsSync(marker) && readFileSync(marker, 'utf8').trim() === sha) {
		log(`snapshot ${label}: reusing ${relative(repo, dir)}`);
		return { label, sha, dir, build: join(dir, 'build'), temporary: false };
	}
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	log(`snapshot ${label}: exporting to ${relative(repo, dir)}`);
	execFileSync('sh', ['-c', 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', 'sh', repo, sha, dir]);
	populateProtocol(repo, sha, dir, log);
	await prepare(repo, dir, { install, log, label });
	writeFileSync(marker, sha);
	return { label, sha, dir, build: join(dir, 'build'), temporary: false };
}

/**
 * Builds the working tree (tracked and untracked, not ignored files, as they are on disk) in its own
 * snapshot, `.qa/snap/work-<time>`, so rebuilding the checkout can't change what a comparison serves.
 *
 * @returns {Promise<Snapshot>}
 */
export async function snapshotWorktree(repo, { install = false, log = console.log } = {}) {
	const head = git(repo, 'rev-parse', '--short=12', 'HEAD');
	const dirty = git(repo, 'status', '--porcelain', '--ignore-submodules=dirty').length > 0;
	const label = `working tree (${head}${dirty ? ' + changes' : ''})`;
	const dir = join(qaDir(repo), 'snap', `work-${stamp()}`);
	mkdirSync(dir, { recursive: true });
	log(`snapshot ${label}: copying to ${relative(repo, dir)}`);
	const files = git(repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
	for (const f of new Set(files)) {
		const from = join(repo, f);
		let st;
		try {
			st = lstatSync(from);
		} catch {
			continue; // Deleted in the working tree.
		}
		if (st.isDirectory()) continue; // A submodule's gitlink; handled below.
		mkdirSync(dirname(join(dir, f)), { recursive: true });
		cpSync(from, join(dir, f), { verbatimSymlinks: true });
	}
	copyProtocol(repo, dir);
	await prepare(repo, dir, { install, log, label });
	return { label, sha: head, dir, build: join(dir, 'build'), temporary: true };
}

/**
 * @typedef {{ label: string, sha: string, dir: string, build: string, temporary: boolean }} Snapshot
 */

/** Fills `<dir>/protocol` with the submodule commit the ref pins, from the local submodule if it has it. */
function populateProtocol(repo, sha, dir, log) {
	let pinned;
	try {
		pinned = git(repo, 'rev-parse', `${sha}:protocol`);
	} catch {
		return; // No submodule at this commit.
	}
	const sub = join(repo, 'protocol');
	mkdirSync(join(dir, 'protocol'), { recursive: true });
	let ownRepo = false;
	try {
		ownRepo = existsSync(join(sub, '.git')) && git(sub, 'rev-parse', '--show-toplevel') === sub;
	} catch {
		ownRepo = false;
	}
	if (ownRepo) {
		try {
			execFileSync('sh', ['-c', 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', 'sh', sub, pinned, join(dir, 'protocol')], { stdio: ['ignore', 'ignore', 'pipe'] });
			return;
		} catch {
			// The local submodule doesn't have that commit; fall back to its working copy.
		}
	}
	if (existsSync(sub)) {
		log(`  protocol ${pinned.slice(0, 12)} isn't available locally; copying the checkout's protocol/ instead`);
		copyProtocol(repo, dir);
	} else log('  no protocol/ checkout (git submodule update --init); building without it');
}

function copyProtocol(repo, dir) {
	const sub = join(repo, 'protocol');
	if (!existsSync(sub)) return;
	cpSync(sub, join(dir, 'protocol'), { recursive: true, verbatimSymlinks: true, filter: (src) => !src.split(sep).includes('.git') });
}

/** Links (or installs) node_modules and runs the build, logging to `<dir>/.qa-build.log`. */
async function prepare(repo, dir, { install, log, label }) {
	const logFile = join(dir, '.qa-build.log');
	if (install) {
		log(`  npm ci in ${relative(repo, dir)}`);
		await run('npm', ['ci', '--no-audit', '--no-fund'], dir, logFile);
	} else {
		if (!existsSync(join(repo, 'node_modules'))) throw new Error('no node_modules in the checkout; run npm ci first');
		symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'dir');
		const ours = readMaybe(join(repo, 'package-lock.json'));
		const theirs = readMaybe(join(dir, 'package-lock.json'));
		if (ours !== theirs) log(`  note: ${label} has a different package-lock.json; it builds with the checkout's node_modules (pass --install to npm ci it)`);
	}
	log(`  building ${label}`);
	const started = Date.now();
	await run('npm', ['run', 'build'], dir, logFile);
	log(`  built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const readMaybe = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);

function run(cmd, args, cwd, logFile) {
	return new Promise((ok, fail) => {
		const chunks = [];
		const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0', APRON_PREVIEW: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
		child.stdout.on('data', (d) => chunks.push(d));
		child.stderr.on('data', (d) => chunks.push(d));
		child.on('error', fail);
		child.on('close', (code) => {
			const out = Buffer.concat(chunks).toString();
			writeFileSync(logFile, out, { flag: 'a' });
			if (code === 0) ok(undefined);
			else fail(new Error(`${cmd} ${args.join(' ')} failed in ${cwd} (exit ${code}):\n${out.split('\n').slice(-25).join('\n')}`));
		});
	});
}

/** Removes a snapshot directory. */
export function removeSnapshot(snapshot) {
	rmSync(snapshot.dir, { recursive: true, force: true });
}

/** A sortable local timestamp, e.g. 20261023-142501. */
export function stamp(date = new Date()) {
	const p = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}
