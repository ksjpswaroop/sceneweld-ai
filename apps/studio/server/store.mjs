import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DirectorProjectSchema } from "director-mcp/dist/director/schema.js";

export const id = () => randomUUID();
const identifier = z.string().uuid();
const finite = z.number().finite();
export const clipSchema = z
  .object({
    id: identifier,
    assetId: identifier,
    shotId: z.string().max(100).optional(),
    title: z.string().max(200),
    in: finite.min(0),
    out: finite.positive(),
    volume: finite.min(0).max(1),
  })
  .strict()
  .refine((c) => c.out > c.in, "Trim end must follow trim start");
export const audioSchema = z
  .object({
    assetId: identifier,
    start: finite.min(0),
    in: finite.min(0),
    out: finite.positive(),
    volume: finite.min(0).max(1),
  })
  .strict()
  .refine((a) => a.out > a.in, "Audio end must follow start");
export const editSchema = z
  .object({
    revision: z.number().int().min(0),
    name: z.string().trim().min(1).max(120),
    clips: z.array(clipSchema).max(100),
    audio: audioSchema.nullable(),
  })
  .strict();
export function validateEdit(edit, project, assets) {
  const parsed = editSchema.parse(edit);
  if (parsed.revision !== project.revision)
    throw Object.assign(
      new Error("This project changed. Reload it before saving."),
      { status: 409 },
    );
  if (new Set(parsed.clips.map((c) => c.id)).size !== parsed.clips.length)
    throw new Error("Duplicate clip ID");
  for (const item of [
    ...parsed.clips,
    ...(parsed.audio ? [parsed.audio] : []),
  ]) {
    const asset = assets.find(
      (a) => a.id === item.assetId && a.projectId === project.id,
    );
    if (!asset) throw new Error("Media does not belong to this project");
    if (item.out > asset.duration + 0.02)
      throw new Error("Trim exceeds media duration");
    if ("id" in item && asset.kind !== "video")
      throw new Error("Timeline clips require video");
    if (!("id" in item) && asset.kind !== "audio")
      throw new Error("Soundtrack requires audio");
  }
  const duration = parsed.clips.reduce((n, c) => n + c.out - c.in, 0);
  if (duration > 600)
    throw new Error("This release supports videos up to 10 minutes");
  return parsed;
}
const projectSchema = z
  .object({
    id: identifier,
    revision: z.number().int().nonnegative(),
    name: z.string().min(1).max(120),
    createdAt: z.string().datetime(),
    director: DirectorProjectSchema,
    shots: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            sceneId: z.string().max(100),
            title: z.string().max(10000),
            duration: finite.positive(),
            prompt: z.string().max(30000),
            sceneTitle: z.string().max(10000),
          })
          .strict(),
      )
      .max(1000),
    clips: z.array(clipSchema).max(100),
    audio: audioSchema.nullable(),
    continuity: z.array(
      z
        .object({
          severity: z.enum(["warn", "error"]),
          sceneId: z.string().optional(),
          shotId: z.string().optional(),
          rule: z.string(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
const assetSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    shotId: z.string().max(100).optional(),
    name: z.string().max(200),
    file: z.string().regex(/^[a-f0-9-]{36}\.(mp4|m4a)$/),
    duration: finite.positive().max(3600),
    kind: z.enum(["video", "audio"]),
    width: finite.positive().optional(),
    height: finite.positive().optional(),
    hasAudio: z.boolean(),
  })
  .strict();
const jobSchema = z
  .object({
    id: identifier,
    projectId: identifier,
    shotId: z.string().max(100).optional(),
    prompt: z.string().max(1000).optional(),
    type: z.enum(["render", "video"]),
    status: z.enum([
      "submitting",
      "queued",
      "running",
      "completed",
      "failed",
      "uncertain",
    ]),
    createdAt: z.string().datetime(),
    remoteId: z.string().max(200).optional(),
    revision: z.number().int().optional(),
    snapshot: projectSchema.optional(),
    duration: finite.positive().optional(),
    assetId: identifier.optional(),
    error: z.string().max(2000).nullable().optional(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(projectSchema),
    assets: z.array(assetSchema),
    jobs: z.array(jobSchema),
  })
  .strict();
export function validateState(state) {
  stateSchema.parse(state);
  for (const key of ["projects", "assets", "jobs"])
    if (new Set(state[key].map((x) => x.id)).size !== state[key].length)
      throw new Error("Duplicate " + key + " IDs");
  for (const p of state.projects) {
    validateEdit(
      { revision: p.revision, name: p.name, clips: p.clips, audio: p.audio },
      p,
      state.assets,
    );
    if (new Set(p.shots.map((x) => x.id)).size !== p.shots.length)
      throw new Error("Duplicate shot IDs");
  }
  for (const a of state.assets)
    if (
      !state.projects.some((p) => p.id === a.projectId) ||
      a.file !== a.id + (a.kind === "video" ? ".mp4" : ".m4a")
    )
      throw new Error("Invalid media reference");
  for (const j of state.jobs)
    if (!state.projects.some((p) => p.id === j.projectId))
      throw new Error("Invalid job project reference");
}
export class Store {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, "state.json");
    this.tail = Promise.resolve();
  }
  async open() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const dir of ["media", "renders", "tmp"])
      await fs.mkdir(path.join(this.root, dir), {
        recursive: true,
        mode: 0o700,
      });
    this.lock = await fs
      .open(path.join(this.root, "server.lock"), "wx", 0o600)
      .catch(() => {
        throw new Error(
          "Studio data is already locked. Stop the other instance before starting.",
        );
      });
    await this.lock.writeFile(String(process.pid));
    try {
      try {
        const stat = await fs.stat(this.file);
        if (stat.size > 20 * 1024 * 1024)
          throw new Error("Studio state exceeds 20 MB");
        this.state = JSON.parse(await fs.readFile(this.file, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        this.state = { version: 1, projects: [], assets: [], jobs: [] };
      }
      validateState(this.state);
      await this.change((s) => {
        for (const j of s.jobs)
          if (["running", "queued"].includes(j.status) && j.type === "render") {
            j.status = "failed";
            j.error =
              "Export interrupted by restart. Export again to resume from the saved timeline.";
          } else if (j.status === "submitting") {
            j.status = "uncertain";
            j.error =
              "Submission was interrupted. Check the provider account before retrying to avoid a duplicate charge.";
          }
      });
    } catch (e) {
      await this.close();
      throw e;
    }
    return this;
  }
  read() {
    return structuredClone(this.state);
  }
  change(fn) {
    const task = this.tail.then(async () => {
      const next = structuredClone(this.state);
      const result = await fn(next);
      validateState(next);
      const tmp = this.file + "." + id() + ".tmp";
      try {
        const h = await fs.open(tmp, "wx", 0o600);
        try {
          await h.writeFile(JSON.stringify(next));
          await h.sync();
        } finally {
          await h.close();
        }
        await fs.rename(tmp, this.file);
      } finally {
        await fs.rm(tmp, { force: true });
      }
      this.state = next;
      return structuredClone(result);
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async close() {
    await this.tail;
    await this.lock?.close();
    if (this.lock) {
      this.lock = null;
      await fs.rm(path.join(this.root, "server.lock"), { force: true });
    }
  }
}
