import { promises as fs } from "fs";
import path from "path";

export const STAGING_FOLDER = ".incoming";
export const QUARANTINE_FOLDER = "failed";
export const TMP_SUFFIX = ".tmp";
export const STALE_UPLOAD_MS = 30 * 60 * 1000;

export type CommitResult =
    | { status: "committed"; name: string; path: string }
    | { status: "incomplete"; received: string[] }
    | { status: "not_found" };

/**
 * True when `name` is safe to use as one path segment under SAVE_PATH: non-empty, no path
 * separators or `..`, no leading dot (the display ignores dot-folders), and none of the
 * characters Windows forbids in file names.
 */
export function isSafePathSegment(name: unknown): name is string {
    return typeof name === "string"
        && name.length > 0
        && name.length <= 200
        && !name.startsWith(".")
        && !name.includes("..")
        && !/[\\/<>:"|?*\x00-\x1f]/.test(name);
}

export function stagingPathFor(savePath: string, uploadName: string): string {
    return path.join(savePath, STAGING_FOLDER, uploadName);
}

export async function writeFileAtomic(filePath: string, data: Uint8Array): Promise<void> {
    const tmpPath = filePath + TMP_SUFFIX;
    await fs.writeFile(tmpPath, data);
    await fs.rename(tmpPath, filePath);
}

export function formatCommitStamp(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Moves a staged Upload into savePath in one rename, under a name that does not exist yet.
 * Files still being written (TMP_SUFFIX) are not counted.
 */
export async function commitUpload(
    savePath: string,
    uploadName: string,
    expectedFiles: number,
    now: Date = new Date()
): Promise<CommitResult> {
    const stagingPath = stagingPathFor(savePath, uploadName);
    if (!(await exists(stagingPath))) {
        return { status: "not_found" };
    }

    const received = await listCompleteFiles(stagingPath);
    if (received.length !== expectedFiles) {
        return { status: "incomplete", received };
    }

    const name = await uniqueName(savePath, `${uploadName}_${formatCommitStamp(now)}`);
    const committedPath = path.join(savePath, name);
    await fs.rename(stagingPath, committedPath);
    return { status: "committed", name, path: committedPath };
}

/** Moves Uploads with no file activity for staleMs into the quarantine folder. Returns the moved names. */
export async function sweepStaleUploads(
    savePath: string,
    staleMs: number = STALE_UPLOAD_MS,
    now: number = Date.now()
): Promise<string[]> {
    const incomingPath = path.join(savePath, STAGING_FOLDER);
    if (!(await exists(incomingPath))) {
        return [];
    }

    const quarantinePath = path.join(savePath, QUARANTINE_FOLDER);
    const moved: string[] = [];
    const entries = await fs.readdir(incomingPath, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const uploadPath = path.join(incomingPath, entry.name);
        if (now - (await lastActivity(uploadPath)) < staleMs) continue;

        await fs.mkdir(quarantinePath, { recursive: true });
        const name = await uniqueName(quarantinePath, entry.name);
        await fs.rename(uploadPath, path.join(quarantinePath, name));
        moved.push(name);
    }

    return moved;
}

async function listCompleteFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
        .filter(e => e.isFile() && !e.name.endsWith(TMP_SUFFIX))
        .map(e => e.name)
        .sort();
}

async function lastActivity(dir: string): Promise<number> {
    let latest = (await fs.stat(dir)).mtimeMs;
    for (const name of await fs.readdir(dir)) {
        const stat = await fs.stat(path.join(dir, name));
        latest = Math.max(latest, stat.mtimeMs);
    }
    return latest;
}

async function uniqueName(dir: string, base: string): Promise<string> {
    if (!(await exists(path.join(dir, base)))) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base}_${n}`;
        if (!(await exists(path.join(dir, candidate)))) return candidate;
    }
}

async function exists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}
