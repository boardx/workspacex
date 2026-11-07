import { spawn } from 'node:child_process';
import { constants, openSync, closeSync, fstatSync } from 'node:fs';

// The persistent inode is never unlinked. Python inherits only this descriptor;
// its stdin is a lifetime pipe, so even a SIGKILL of Node releases the OS lock.
const HOLDER = String.raw`
import fcntl, os, stat, sys
try:
    info = os.fstat(3)
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
        sys.exit(74)
    fcntl.flock(3, fcntl.LOCK_EX | fcntl.LOCK_NB)
    print('READY', flush=True)
    sys.stdin.buffer.read()
except BlockingIOError:
    sys.exit(73)
except BaseException:
    sys.exit(74)
`;
const lockError = message => Object.assign(new Error(message), { safe: true });

export async function acquireLock(path, onLost = () => {}) {
    let fd;
    let child;
    try {
        fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        const info = fstatSync(fd);
        if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid())
            throw lockError('Unsafe billing preparation lock');
        child = spawn('python3', ['-I', '-u', '-c', HOLDER], { stdio: ['pipe', 'pipe', 'ignore', fd], env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
    } catch {
        throw lockError('Unsafe billing preparation lock');
    } finally {
        // Only Python owns the open description after spawn. Retaining this fd
        // would keep flock alive after the holder closes it.
        if (fd !== undefined) closeSync(fd);
    }

    let released = false;
    let ready = false;
    let timer;
    let resolveReady;
    let rejectReady;
    const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const unavailable = () => lockError('Billing preparation lock held or unavailable; Python 3 is required');
    child.stdin.on('error', () => {}); // EOF/release can race a holder's exit.
    child.once('error', () => { rejectReady(unavailable()); finish(); });
    child.once('close', () => {
        finish();
        if (!ready) rejectReady(unavailable());
        else if (!released) onLost();
    });
    let output = '';
    child.stdout.on('data', chunk => {
        output += chunk.toString('utf8');
        if (output === 'READY\n') { ready = true; resolveReady(); }
        else if (output.length >= 6) rejectReady(unavailable());
    });
    timer = setTimeout(() => rejectReady(unavailable()), 5000);

    async function release() {
        if (released) return;
        released = true;
        child.stdin.end();
        let closeTimer;
        try {
            await Promise.race([finished, new Promise(resolve => {
                closeTimer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
            })]);
            // Wait for actual exit, including after forced termination. Never
            // unlink the shared inode, which could split concurrent lock users.
            await finished;
        } finally { clearTimeout(closeTimer); }
    }
    try {
        await readiness;
        return release;
    } catch (error) {
        await release();
        throw error;
    } finally { clearTimeout(timer); }
}
