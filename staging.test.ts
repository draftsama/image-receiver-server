import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
    commitUpload,
    QUARANTINE_FOLDER,
    stagingPathFor,
    sweepStaleUploads,
    TMP_SUFFIX,
    writeFileAtomic,
} from "./staging";

let savePath: string;
const bytes = new Uint8Array([1, 2, 3]);
const at = new Date(2026, 10, 13, 14, 3, 5);

beforeEach(async () => {
    savePath = await fs.mkdtemp(path.join(os.tmpdir(), "receiver-staging-"));
});

afterEach(async () => {
    await fs.rm(savePath, { recursive: true, force: true });
});

async function stage(uploadName: string, files: string[]): Promise<string> {
    const dir = stagingPathFor(savePath, uploadName);
    await fs.mkdir(dir, { recursive: true });
    for (const f of files) await writeFileAtomic(path.join(dir, f), bytes);
    return dir;
}

describe("writeFileAtomic", () => {
    test("leaves only the final file", async () => {
        const target = path.join(savePath, "foreground.png");
        await writeFileAtomic(target, bytes);
        expect(await fs.readdir(savePath)).toEqual(["foreground.png"]);
    });
});

describe("commitUpload", () => {
    test("renames a complete upload into savePath with a timestamped name", async () => {
        await stage("sig42_c7", ["foreground.png", "background_1_2.png", "background_2_2.png"]);

        const result = await commitUpload(savePath, "sig42_c7", 3, at);

        expect(result).toEqual({
            status: "committed",
            name: "sig42_c7_1113-140305",
            path: path.join(savePath, "sig42_c7_1113-140305"),
        });
        expect((await fs.readdir(path.join(savePath, "sig42_c7_1113-140305"))).sort())
            .toEqual(["background_1_2.png", "background_2_2.png", "foreground.png"]);
        expect(await fs.readdir(path.join(savePath, ".incoming"))).toEqual([]);
    });

    test("reports what arrived when the count does not match, and keeps the upload staged", async () => {
        const dir = await stage("sig42_c7", ["foreground.png", "background_1_2.png"]);
        await fs.writeFile(path.join(dir, "background_2_2.png" + TMP_SUFFIX), bytes);

        const result = await commitUpload(savePath, "sig42_c7", 3, at);

        expect(result).toEqual({ status: "incomplete", received: ["background_1_2.png", "foreground.png"] });
        expect(await fs.readdir(dir)).toHaveLength(3);
    });

    test("adds a suffix when the committed name already exists", async () => {
        await fs.mkdir(path.join(savePath, "vip_sig7_c2_1113-140305"));
        await stage("vip_sig7_c2", ["video.mp4"]);

        const result = await commitUpload(savePath, "vip_sig7_c2", 1, at);

        expect(result).toMatchObject({ status: "committed", name: "vip_sig7_c2_1113-140305_2" });
    });

    test("returns not_found when nothing is staged", async () => {
        expect(await commitUpload(savePath, "missing_c1", 1, at)).toEqual({ status: "not_found" });
    });
});

describe("sweepStaleUploads", () => {
    test("moves only idle uploads into quarantine", async () => {
        await stage("old_c1", ["foreground.png"]);
        await stage("fresh_c2", ["foreground.png"]);
        const stale = (Date.now() - 31 * 60 * 1000) / 1000;
        const oldDir = stagingPathFor(savePath, "old_c1");
        await fs.utimes(path.join(oldDir, "foreground.png"), stale, stale);
        await fs.utimes(oldDir, stale, stale);

        const moved = await sweepStaleUploads(savePath, 30 * 60 * 1000);

        expect(moved).toEqual(["old_c1"]);
        expect(await fs.readdir(path.join(savePath, QUARANTINE_FOLDER))).toEqual(["old_c1"]);
        expect(await fs.readdir(path.join(savePath, ".incoming"))).toEqual(["fresh_c2"]);
    });
});
