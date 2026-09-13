import express from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Store, id, validateEdit } from "./store.mjs";
import { probe, normalizeUpload, renderTimeline, run } from "./media.mjs";
import { createPlan, fromDirector } from "./director.mjs";
import { submitVideo } from "./video.mjs";
import { advanceVideoJob } from "./jobs.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(
  process.env.SCENEMELD_DATA_DIR ??
    path.join(os.homedir(), ".scenemeld-studio"),
);
const port = Number(process.env.PORT ?? 4317);
const store = await new Store(root).open();
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (!["127.0.0.1", "localhost"].includes(req.hostname))
    return res
      .status(403)
      .json({ error: "Studio only accepts local connections." });
  if (
    req.headers.origin &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
      req.headers.origin,
    )
  )
    return res.status(403).json({ error: "Cross-site request refused." });
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  });
  next();
});
app.use(express.json({ limit: "10mb" }));
function project(state, projectId) {
  const p = state.projects.find((p) => p.id === projectId);
  if (!p) throw Object.assign(new Error("Project not found"), { status: 404 });
  return p;
}
function view(projectId) {
  const s = store.read();
  return {
    project: project(s, projectId),
    assets: s.assets.filter((a) => a.projectId === projectId),
    jobs: s.jobs
      .filter((j) => j.projectId === projectId)
      .map(({ snapshot, ...j }) => j),
  };
}
function clipFor(asset, shot) {
  return {
    id: id(),
    assetId: asset.id,
    ...(shot ? { shotId: shot.id } : {}),
    title: (shot?.title ?? asset.name).slice(0, 200),
    in: 0,
    out: Math.min(asset.duration, shot?.duration ?? asset.duration),
    volume: 1,
  };
}
app.get("/api/config", async (req, res) => {
  let ffmpeg = true;
  try {
    await run("ffmpeg", ["-version"]);
  } catch {
    ffmpeg = false;
  }
  res.json({
    planning: !!process.env.OPENAI_API_KEY,
    video: !!process.env.RUNWAYML_API_SECRET,
    ffmpeg,
  });
});
app.get("/api/projects", (req, res) =>
  res.json(
    store.read().projects.map(({ id, name, revision, createdAt, clips }) => ({
      id,
      name,
      revision,
      createdAt,
      clips: clips.length,
    })),
  ),
);
app.get("/api/projects/:id", (req, res) => res.json(view(req.params.id)));
app.post("/api/projects", async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(120),
      intent: z.string().trim().min(3).max(4000),
      duration: z.number().min(5).max(120),
      provider: z.enum(["local-mock", "openai-byok"]),
    })
    .strict()
    .parse(req.body);
  const p = await createPlan(input);
  await store.change((s) => s.projects.push(p));
  res.status(201).json(view(p.id));
});
app.post("/api/import-director", async (req, res) => {
  const p = fromDirector(req.body);
  await store.change((s) => s.projects.push(p));
  res.status(201).json(view(p.id));
});
app.put("/api/projects/:id", async (req, res) => {
  await store.change((s) => {
    const p = project(s, req.params.id);
    const edit = validateEdit(req.body, p, s.assets);
    Object.assign(p, edit, { revision: p.revision + 1 });
  });
  res.json(view(req.params.id));
});
app.get("/api/projects/:id/director", (req, res) => {
  const p = project(store.read(), req.params.id);
  res
    .attachment("plan.scenemeld.json")
    .json({ version: 1, sequences: [], directive: p.director });
});
const upload = multer({
  dest: path.join(root, "tmp"),
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
});
let processingUpload = false;
app.post(
  "/api/projects/:id/media",
  (req, res, next) => {
    try {
      project(store.read(), req.params.id);
      if (processingUpload)
        return res.status(429).json({
          error: "Another file is being imported. Wait for it to finish.",
        });
      next();
    } catch (e) {
      next(e);
    }
  },
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new Error("Choose a media file");
    processingUpload = true;
    let output;
    try {
      const meta = await probe(req.file.path),
        assetId = id(),
        file = assetId + (meta.kind === "video" ? ".mp4" : ".m4a");
      output = path.join(root, "media", file);
      await normalizeUpload(req.file.path, output, meta.kind);
      const normalized = await probe(output);
      const asset = {
        id: assetId,
        projectId: req.params.id,
        name: req.file.originalname.slice(0, 200),
        file,
        ...normalized,
      };
      await store.change((s) => {
        project(s, req.params.id);
        s.assets.push(asset);
      });
      res.status(201).json(view(req.params.id));
    } catch (e) {
      if (output) await fs.rm(output, { force: true });
      throw e;
    } finally {
      processingUpload = false;
      await fs.rm(req.file.path, { force: true });
    }
  },
);
app.post("/api/projects/:id/add-media", async (req, res) => {
  const input = z
    .object({
      assetId: z.string().uuid(),
      shotId: z.string().max(100).optional(),
      revision: z.number().int(),
    })
    .strict()
    .parse(req.body);
  await store.change((s) => {
    const p = project(s, req.params.id);
    if (p.revision !== input.revision)
      throw Object.assign(
        new Error("Project changed. Reload before adding media."),
        { status: 409 },
      );
    const a = s.assets.find(
      (a) => a.id === input.assetId && a.projectId === p.id,
    );
    if (!a) throw new Error("Media not found");
    const shot = input.shotId
      ? p.shots.find((x) => x.id === input.shotId)
      : null;
    if (input.shotId && !shot) throw new Error("Shot not found");
    if (a.kind === "video") p.clips.push(clipFor(a, shot));
    else
      p.audio = {
        assetId: a.id,
        start: 0,
        in: 0,
        out: a.duration,
        volume: 0.5,
      };
    validateEdit(
      { revision: p.revision, name: p.name, clips: p.clips, audio: p.audio },
      p,
      s.assets,
    );
    p.revision++;
  });
  res.json(view(req.params.id));
});
app.get("/api/media/:id", (req, res) => {
  const a = store.read().assets.find((a) => a.id === req.params.id);
  if (!a) return res.sendStatus(404);
  res.sendFile(path.join(root, "media", a.file), { dotfiles: "allow" });
});
app.post("/api/projects/:id/generate", async (req, res) => {
  const input = z
    .object({
      shotId: z.string().min(1).max(100),
      prompt: z.string().trim().min(3).max(1000),
    })
    .strict()
    .parse(req.body);
  if (!process.env.RUNWAYML_API_SECRET)
    return res.status(400).json({
      error:
        "Runway key is not configured. Save RUNWAYML_API_SECRET in the server environment and restart.",
    });
  const job = await store.change((s) => {
    const p = project(s, req.params.id);
    if (!p.shots.some((x) => x.id === input.shotId))
      throw new Error("Shot not found");
    if (
      s.jobs.some(
        (j) =>
          j.type === "video" &&
          j.projectId === p.id &&
          j.shotId === input.shotId &&
          ["submitting", "running", "uncertain"].includes(j.status),
      )
    )
      throw new Error("A generation is already pending for this shot.");
    const j = {
      id: id(),
      projectId: p.id,
      shotId: input.shotId,
      prompt: input.prompt,
      type: "video",
      status: "submitting",
      createdAt: new Date().toISOString(),
    };
    s.jobs.push(j);
    return j;
  });
  try {
    const remote = await submitVideo(input.prompt);
    if (typeof remote.id !== "string")
      throw new Error("Provider returned no job ID");
    await store.change((s) => {
      Object.assign(
        s.jobs.find((j) => j.id === job.id),
        { remoteId: remote.id, status: "running" },
      );
    });
  } catch (e) {
    await store.change((s) => {
      Object.assign(
        s.jobs.find((j) => j.id === job.id),
        {
          status: e.status && e.status < 500 ? "failed" : "uncertain",
          error: e.message,
        },
      );
    });
  }
  res.status(202).json(view(req.params.id));
});
let renderQueue = Promise.resolve();
app.post("/api/projects/:id/export", async (req, res) => {
  const revision = z
    .object({ revision: z.number().int() })
    .strict()
    .parse(req.body).revision;
  const job = await store.change((s) => {
    const p = project(s, req.params.id);
    if (p.revision !== revision)
      throw Object.assign(
        new Error("Save or reload your latest edits before export."),
        { status: 409 },
      );
    if (!p.clips.length) throw new Error("Add a clip before exporting.");
    if (
      s.jobs.some(
        (j) =>
          j.projectId === p.id &&
          j.type === "render" &&
          ["queued", "running"].includes(j.status),
      )
    )
      throw new Error("An export is already running.");
    const j = {
      id: id(),
      projectId: p.id,
      type: "render",
      status: "queued",
      createdAt: new Date().toISOString(),
      revision: p.revision,
      snapshot: structuredClone(p),
    };
    s.jobs.push(j);
    return j;
  });
  renderQueue = renderQueue
    .then(async () => {
      await store.change((s) => {
        s.jobs.find((j) => j.id === job.id).status = "running";
      });
      try {
        const meta = await renderTimeline(
          job.snapshot,
          store.read().assets,
          root,
          job.id,
        );
        await store.change((s) =>
          Object.assign(
            s.jobs.find((j) => j.id === job.id),
            { status: "completed", duration: meta.duration },
          ),
        );
      } catch (e) {
        await store.change((s) =>
          Object.assign(
            s.jobs.find((j) => j.id === job.id),
            { status: "failed", error: e.message },
          ),
        );
      }
    })
    .catch(() => {});
  res.status(202).json(view(req.params.id));
});
app.get("/api/exports/:id", (req, res) => {
  const j = store
    .read()
    .jobs.find(
      (j) =>
        j.id === req.params.id &&
        j.type === "render" &&
        j.status === "completed",
    );
  if (!j) return res.sendStatus(404);
  res.download(
    path.join(root, "renders", j.id + ".mp4"),
    "SceneMeld-" + j.id.slice(0, 8) + ".mp4",
    { dotfiles: "allow" },
  );
});
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    for (const job of store
      .read()
      .jobs.filter(
        (j) => j.type === "video" && j.status === "running" && j.remoteId,
      )) {
      await advanceVideoJob(store, root, job);
    }
  } finally {
    polling = false;
  }
}
const timer = setInterval(() => poll().catch(() => {}), 10000);
timer.unref();
app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
app.use(express.static(path.join(base, "dist")));
app.get("/", (req, res) => res.sendFile(path.join(base, "dist", "index.html")));
app.use((err, req, res, next) => {
  res.status(err.status >= 400 && err.status < 500 ? err.status : 400).json({
    error:
      err instanceof z.ZodError
        ? "Invalid input: " + err.issues.map((i) => i.message).join("; ")
        : err.code === "LIMIT_FILE_SIZE"
          ? "File exceeds 500 MB."
          : err.message || "Request failed",
  });
});
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`SceneMeld Studio: http://127.0.0.1:${port}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await new Promise((resolve) => server.close(resolve));
  await renderQueue;
  while (polling) await new Promise((r) => setTimeout(r, 100));
  await store.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
