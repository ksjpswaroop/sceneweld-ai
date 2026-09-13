import { pollVideo, downloadVideo } from "./video.mjs";
import { id } from "./store.mjs";
export async function advanceVideoJob(
  store,
  root,
  job,
  { poll = pollVideo, download = downloadVideo } = {},
) {
  try {
    const task = await poll(job.remoteId);
    if (task.status === "SUCCEEDED") {
      if (!task.output?.[0])
        throw new Error("Completed generation has no downloadable output");
      const asset = await download(
        task.output[0],
        root,
        job.projectId,
        job.shotId,
        job.id,
      );
      await store.change((s) => {
        const current = s.jobs.find((j) => j.id === job.id);
        if (current.status === "completed") return;
        const p = s.projects.find((p) => p.id === job.projectId);
        if (!p) throw new Error("Project not found");
        const shot = p.shots.find((x) => x.id === job.shotId);
        if (!shot) throw new Error("Shot not found");
        if (!s.assets.some((a) => a.id === asset.id)) s.assets.push(asset);
        const clip = {
          id: id(),
          assetId: asset.id,
          shotId: shot.id,
          title: shot.title.slice(0, 200),
          in: 0,
          out: Math.min(asset.duration, shot.duration),
          volume: 1,
        };
        if (
          p.clips.reduce((n, c) => n + c.out - c.in, 0) + clip.out <= 600 &&
          p.clips.length < 100
        ) {
          p.clips.push(clip);
          p.revision++;
        }
        Object.assign(current, {
          status: "completed",
          assetId: asset.id,
          error: null,
        });
      });
    } else if (["FAILED", "CANCELED"].includes(task.status))
      await store.change((s) =>
        Object.assign(
          s.jobs.find((j) => j.id === job.id),
          {
            status: "failed",
            error:
              "Provider generation failed or was canceled. Review the prompt and provider account before trying again.",
          },
        ),
      );
  } catch (e) {
    await store.change((s) => {
      s.jobs.find((j) => j.id === job.id).error = e.message;
    });
  }
}
