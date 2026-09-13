import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPlan } from "../server/director.mjs";
import { Store, id, validateEdit } from "../server/store.mjs";
import { run, probe, renderTimeline } from "../server/media.mjs";

test("edits survive restart, concurrent updates serialize, interrupted jobs recover", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-store-"));
  let s;
  try {
    s = await new Store(dir).open();
    const fixture = await createPlan({
      name: "Persistence test",
      intent: "A forest",
      duration: 10,
      provider: "local-mock",
    });
    const jobBase = {
      id: id(),
      projectId: fixture.id,
      createdAt: new Date().toISOString(),
    };
    await s.change((d) => {
      d.projects.push(fixture);
      d.jobs.push(
        { ...jobBase, id: id(), type: "render", status: "running" },
        { ...jobBase, id: id(), type: "video", status: "submitting" },
        {
          ...jobBase,
          id: id(),
          type: "video",
          status: "running",
          remoteId: "provider-id",
        },
      );
    });
    await Promise.all(
      Array.from({ length: 5 }, () =>
        s.change((d) => {
          d.projects[0].revision++;
        }),
      ),
    );
    await s.close();
    s = await new Store(dir).open();
    assert.equal(s.read().projects[0].revision, 5);
    assert.equal(s.read().jobs[0].status, "failed");
    assert.equal(s.read().jobs[1].status, "uncertain");
    assert.equal(s.read().jobs[2].remoteId, "provider-id");
    await assert.rejects(new Store(dir).open(), /locked/);
  } finally {
    await s?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("rejects conflicting saves and media outside project or trim bounds", () => {
  const asset = { id: id(), projectId: "p", kind: "video", duration: 4 };
  const clip = {
    id: id(),
    assetId: asset.id,
    title: "Clip",
    in: 0,
    out: 3,
    volume: 1,
  };
  const edit = { revision: 0, name: "Test", clips: [clip], audio: null };
  assert.equal(
    validateEdit(edit, { id: "p", revision: 0 }, [asset]).clips.length,
    1,
  );
  assert.throws(
    () => validateEdit(edit, { id: "p", revision: 1 }, [asset]),
    /changed/,
  );
  assert.throws(
    () =>
      validateEdit(
        { ...edit, clips: [{ ...clip, out: 5 }] },
        { id: "p", revision: 0 },
        [asset],
      ),
    /duration/,
  );
  assert.throws(
    () => validateEdit(edit, { id: "q", revision: 0 }, [asset]),
    /belong/,
  );
});
test("exports trimmed reordered video with soundtrack to a playable MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-render-"));
  try {
    for (const d of ["tmp", "media", "renders"])
      await fs.mkdir(path.join(root, d));
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:d=2:r=30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path.join(root, "media", "red.mp4"),
    ]);
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:d=2:r=30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path.join(root, "media", "blue.mp4"),
    ]);
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-c:a",
      "aac",
      path.join(root, "media", "tone.m4a"),
    ]);
    const assets = [
      { id: "red", file: "red.mp4", hasAudio: false },
      { id: "blue", file: "blue.mp4", hasAudio: false },
      { id: "tone", file: "tone.m4a" },
    ];
    const project = {
      clips: [
        { assetId: "blue", in: 0.5, out: 1.5, volume: 1 },
        { assetId: "red", in: 0, out: 1, volume: 1 },
      ],
      audio: { assetId: "tone", start: 0, in: 0, out: 2, volume: 0.3 },
    };
    const result = await renderTimeline(project, assets, root, "test");
    assert.equal(result.kind, "video");
    assert.equal(result.hasAudio, true);
    assert.ok(Math.abs(result.duration - 2) < 0.15, result.duration);
    assert.equal(result.width, 1280);
    const rgb = await new Promise(async (resolve, reject) => {
      const { spawn } = await import("node:child_process");
      const p = spawn("ffmpeg", [
        "-v",
        "error",
        "-i",
        path.join(root, "renders", "test.mp4"),
        "-frames:v",
        "1",
        "-vf",
        "scale=1:1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ]);
      let b = [];
      p.stdout.on("data", (d) => b.push(d));
      p.on("close", (c) =>
        c ? reject(new Error("frame decode")) : resolve(Buffer.concat(b)),
      );
    });
    assert.ok(
      rgb[2] > rgb[0] + 100,
      "First frame must be the reordered blue clip",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("corrupt state is preserved and an invalid transaction cannot replace saved data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-corruption-"));
  let s;
  try {
    s = await new Store(root).open();
    const before = await fs.readFile(s.file, "utf8");
    await assert.rejects(
      s.change((d) => {
        d.version = 99;
      }),
    );
    assert.equal(await fs.readFile(s.file, "utf8"), before);
    await s.close();
    s = null;
    await fs.writeFile(path.join(root, "state.json"), "{broken");
    await assert.rejects(new Store(root).open());
    assert.equal(
      await fs.readFile(path.join(root, "state.json"), "utf8"),
      "{broken",
    );
    await assert.rejects(fs.access(path.join(root, "server.lock")));
  } finally {
    await s?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
