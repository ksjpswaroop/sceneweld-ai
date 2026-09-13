import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, id } from "../server/store.mjs";
import { createPlan } from "../server/director.mjs";
import { run, probe } from "../server/media.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test(
  "real HTTP workflow: import, range preview, edit conflict, render download and restart",
  { timeout: 30000 },
  async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "studio-http-")),
      root = path.join(temp, ".studio-data");
    const origin = "http://127.0.0.1:4318";
    let server;
    const start = async () => {
      server = spawn(process.execPath, ["server/index.mjs"], {
        cwd: process.env.STUDIO_TEST_DIR ?? new URL("..", import.meta.url),
        env: {
          ...process.env,
          PORT: "4318",
          SCENEMELD_DATA_DIR: root,
          OPENAI_API_KEY: "",
          RUNWAYML_API_SECRET: "",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let ready = false;
      server.stdout.on("data", (d) => {
        if (String(d).includes("SceneMeld Studio")) ready = true;
      });
      for (let i = 0; i < 100 && !ready; i++) {
        if (server.exitCode !== null)
          throw new Error("Server exited before ready");
        await sleep(50);
      }
      assert.ok(ready);
    };
    const stop = async () => {
      if (server && server.exitCode === null) {
        const done = new Promise((r) => server.once("exit", r));
        server.send("shutdown");
        await done;
      }
      server = null;
    };
    const call = async (url, method = "GET", body) => {
      const r = await fetch(origin + "/api" + url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, data: await r.json() };
    };
    try {
      const fixture = await new Store(root).open();
      const recoveryProject = await createPlan({
        name: "Recovery fixture",
        intent: "A test",
        duration: 10,
        provider: "local-mock",
      });
      const jobId = id();
      await fixture.change((s) => {
        s.projects.push(recoveryProject);
        s.jobs.push({
          id: jobId,
          projectId: recoveryProject.id,
          shotId: recoveryProject.shots[0].id,
          type: "video",
          status: "uncertain",
          createdAt: new Date().toISOString(),
        });
      });
      await fixture.close();
      await start();
      assert.equal(
        (
          await call("/jobs/" + jobId + "/reconcile", "POST", {
            confirmedNotSubmitted: false,
          })
        ).status,
        400,
      );
      const recovered = await call("/jobs/" + jobId + "/reconcile", "POST", {
        confirmedNotSubmitted: true,
      });
      assert.equal(recovered.status, 200);
      assert.equal(recovered.data.jobs[0].status, "failed");
      assert.equal(
        (
          await fetch(origin + "/api/projects", {
            headers: { Origin: "https://untrusted.example" },
          })
        ).status,
        403,
      );
      const created = await call("/projects", "POST", {
        name: "HTTP test",
        intent: "A lighthouse",
        duration: 10,
        provider: "local-mock",
      });
      assert.equal(created.status, 201);
      const pid = created.data.project.id;
      const file = path.join(temp, "test.mp4");
      await run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:d=2:r=30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        file,
      ]);
      const form = new FormData();
      form.append("file", new Blob([await fs.readFile(file)]), "test.mp4");
      const uploaded = await fetch(origin + "/api/projects/" + pid + "/media", {
        method: "POST",
        body: form,
      }).then((r) => r.json());
      assert.equal(uploaded.assets.length, 1);
      const aid = uploaded.assets[0].id;
      const preview = await fetch(origin + "/api/media/" + aid, {
        headers: { Range: "bytes=0-99" },
      });
      assert.equal(preview.status, 206);
      assert.equal((await preview.arrayBuffer()).byteLength, 100);
      assert.match(preview.headers.get("content-type"), /video\/mp4/);
      let view = (
        await call("/projects/" + pid + "/add-media", "POST", {
          assetId: aid,
          revision: 0,
        })
      ).data;
      const edit = {
        revision: 1,
        name: "Edited HTTP",
        clips: [{ ...view.project.clips[0], in: 0.25, out: 1.25 }],
        audio: null,
      };
      assert.equal((await call("/projects/" + pid, "PUT", edit)).status, 200);
      assert.equal((await call("/projects/" + pid, "PUT", edit)).status, 409);
      const rendering = await call("/projects/" + pid + "/export", "POST", {
        revision: 2,
      });
      assert.equal(rendering.status, 202);
      const jid = rendering.data.jobs[0].id;
      for (let i = 0; i < 100; i++) {
        view = (await call("/projects/" + pid)).data;
        if (view.jobs[0].status === "completed") break;
        assert.notEqual(view.jobs[0].status, "failed", view.jobs[0].error);
        await sleep(100);
      }
      assert.equal(view.jobs[0].status, "completed");
      const download = await fetch(origin + "/api/exports/" + jid);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition"), /attachment/);
      const output = path.join(temp, "export.mp4");
      await fs.writeFile(output, Buffer.from(await download.arrayBuffer()));
      assert.ok(Math.abs((await probe(output)).duration - 1) < 0.15);
      assert.equal(
        (
          await call("/projects/" + pid + "/generate", "POST", {
            shotId: view.project.shots[0].id,
            prompt: "The lighthouse",
          })
        ).status,
        400,
      );
      await stop();
      await start();
      view = (await call("/projects/" + pid)).data;
      assert.equal(view.project.clips[0].in, 0.25);
      assert.equal(view.project.name, "Edited HTTP");
      assert.equal(view.jobs[0].status, "completed");
    } finally {
      await stop();
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);
