import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export function run(command, args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
    }, timeout);
    p.stdout.on("data", (d) => {
      if (stdout.length < 200000) stdout += d;
    });
    p.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-8000);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(
            `${command} could not process this media (${code ?? "timeout"}).`,
          ),
        );
      else resolve(stdout);
    });
  });
}
export async function probe(file) {
  const p = JSON.parse(
    await run("ffprobe", [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      file,
    ]),
  );
  const duration = Number(p.format?.duration);
  const video = p.streams?.find((s) => s.codec_type === "video");
  const audio = p.streams?.find((s) => s.codec_type === "audio");
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 3600 ||
    (!video && !audio)
  )
    throw new Error("Choose a video or audio file shorter than one hour");
  return {
    duration,
    kind: video ? "video" : "audio",
    width: video?.width,
    height: video?.height,
    hasAudio: !!audio,
  };
}
export async function normalizeUpload(input, output, kind) {
  const args = [
    "-v",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    input,
  ];
  if (kind === "video")
    args.push(
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
    );
  else args.push("-vn", "-c:a", "aac", "-ar", "48000");
  await run("ffmpeg", [...args, output], { timeout: 600000 });
}
export async function renderTimeline(project, assets, root, jobId) {
  if (!project.clips.length)
    throw new Error("Add at least one clip before exporting");
  const tmp = path.join(root, "tmp", jobId);
  await fs.mkdir(tmp, { recursive: true });
  const output = path.join(root, "renders", jobId + ".mp4");
  try {
    let index = 0;
    for (const clip of project.clips) {
      const asset = assets.find((a) => a.id === clip.assetId);
      if (!asset) throw new Error("Missing clip media");
      const args = [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        String(clip.in),
        "-i",
        path.join(root, "media", asset.file),
      ];
      if (!asset.hasAudio)
        args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      args.push(
        "-t",
        String(clip.out - clip.in),
        "-map",
        "0:v:0",
        "-map",
        asset.hasAudio ? "0:a:0" : "1:a:0",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-af",
        `volume=${clip.volume},aresample=48000`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-ac",
        "2",
        path.join(tmp, `${index++}.mp4`),
      );
      await run("ffmpeg", args, { timeout: 600000 });
    }
    await fs.writeFile(
      path.join(tmp, "clips.txt"),
      Array.from({ length: index }, (_, i) => `file '${i}.mp4'`).join("\n"),
    );
    const joined = path.join(tmp, "joined.mp4");
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        path.join(tmp, "clips.txt"),
        "-c",
        "copy",
        joined,
      ],
      { timeout: 600000 },
    );
    if (project.audio) {
      const a = project.audio,
        asset = assets.find((x) => x.id === a.assetId);
      if (!asset) throw new Error("Missing soundtrack");
      const delay = Math.round(a.start * 1000);
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-i",
          joined,
          "-ss",
          String(a.in),
          "-t",
          String(a.out - a.in),
          "-i",
          path.join(root, "media", asset.file),
          "-filter_complex",
          `[1:a]volume=${a.volume},adelay=${delay}|${delay}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0[a]`,
          "-map",
          "0:v:0",
          "-map",
          "[a]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-movflags",
          "+faststart",
          output,
        ],
        { timeout: 600000 },
      );
    } else
      await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-y",
          "-i",
          joined,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          output,
        ],
        { timeout: 600000 },
      );
    return await probe(output);
  } catch (e) {
    await fs.rm(output, { force: true });
    throw e;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
