import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { submitVideo, pollVideo } from "../server/video.mjs";
import { advanceVideoJob } from "../server/jobs.mjs";
import { Store, id } from "../server/store.mjs";
import { createPlan } from "../server/director.mjs";

test("Runway adapter submits once, uses official endpoint, and redacts provider error bodies", async () => {
  const originalFetch = globalThis.fetch,
    originalKey = process.env.RUNWAYML_API_SECRET;
  process.env.RUNWAYML_API_SECRET = "test-only";
  let calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: "remote-job" }));
    };
    assert.equal((await submitVideo("A lighthouse at dusk")).id, "remote-job");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://api.dev.runwayml.com/v1/image_to_video",
    );
    assert.equal(JSON.parse(calls[0].options.body).duration, 5);
    assert.equal(JSON.parse(calls[0].options.body).model, "gen4.5");
    assert.equal(calls[0].options.headers["X-Runway-Version"], "2024-11-06");
    globalThis.fetch = async () =>
      new Response("private-provider-detail", { status: 401 });
    await assert.rejects(
      pollVideo("remote-job"),
      (e) => e.status === 401 && !e.message.includes("private-provider-detail"),
    );
    globalThis.fetch = async () => {
      throw new Error("connection interrupted");
    };
    await assert.rejects(submitVideo("A lighthouse at dusk"));
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RUNWAYML_API_SECRET;
    else process.env.RUNWAYML_API_SECRET = originalKey;
  }
});
test("completed generation attaches once and transient failures preserve the remote job for recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studio-jobs-"));
  let store;
  try {
    store = await new Store(root).open();
    const project = await createPlan({
      name: "Generation test",
      intent: "An ocean",
      duration: 10,
      provider: "local-mock",
    });
    const job = {
      id: id(),
      projectId: project.id,
      shotId: project.shots[0].id,
      type: "video",
      status: "running",
      remoteId: "existing-job",
      createdAt: new Date().toISOString(),
    };
    await store.change((s) => {
      s.projects.push(project);
      s.jobs.push(job);
    });
    await advanceVideoJob(store, root, job, {
      poll: async () => {
        throw new Error("temporary outage");
      },
    });
    assert.equal(store.read().jobs[0].status, "running");
    assert.equal(store.read().jobs[0].remoteId, "existing-job");
    const asset = {
      id: job.id,
      projectId: project.id,
      shotId: job.shotId,
      name: "Generated shot",
      file: job.id + ".mp4",
      duration: 5,
      kind: "video",
      hasAudio: true,
      width: 1280,
      height: 720,
    };
    const adapter = {
      poll: async () => ({
        status: "SUCCEEDED",
        output: ["https://example.invalid/test.mp4"],
      }),
      download: async () => asset,
    };
    await advanceVideoJob(store, root, job, adapter);
    await advanceVideoJob(store, root, job, adapter);
    const state = store.read();
    assert.equal(state.assets.length, 1);
    assert.equal(state.projects[0].clips.length, 1);
    assert.equal(state.projects[0].clips[0].shotId, job.shotId);
    assert.equal(state.jobs[0].status, "completed");
  } finally {
    await store?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
