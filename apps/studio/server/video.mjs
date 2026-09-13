import { promises as fs } from "node:fs";
import path from "node:path";
import { id } from "./store.mjs";
import { probe, normalizeUpload } from "./media.mjs";
const origin = "https://api.dev.runwayml.com/v1";
async function request(endpoint, options = {}) {
  if (!process.env.RUNWAYML_API_SECRET)
    throw new Error(
      "Save RUNWAYML_API_SECRET in the server environment to generate video.",
    );
  const response = await fetch(origin + endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`,
      "X-Runway-Version": "2024-11-06",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Runway request failed (${response.status}). Check credits, model access and provider status.`,
      ),
      { status: response.status },
    );
  let json = "";
  for await (const chunk of response.body) {
    json += Buffer.from(chunk).toString("utf8");
    if (json.length > 1024 * 1024)
      throw new Error("Provider response exceeded the size limit");
  }
  return JSON.parse(json);
}
export async function submitVideo(prompt) {
  return request("/image_to_video", {
    method: "POST",
    body: JSON.stringify({
      model: "gen4.5",
      promptText: prompt,
      ratio: "1280:720",
      duration: 5,
    }),
  });
}
export async function pollVideo(remoteId) {
  return request("/tasks/" + encodeURIComponent(remoteId));
}
export async function downloadVideo(
  url,
  root,
  projectId,
  shotId,
  assetId = id(),
) {
  const file = assetId + ".mp4",
    destination = path.join(root, "media", file);
  const record = async () => ({
    id: assetId,
    projectId,
    shotId,
    name: "Generated shot",
    file,
    ...(await probe(destination)),
  });
  try {
    await fs.access(destination);
    return await record();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !(
      parsed.hostname.endsWith(".cloudfront.net") ||
      parsed.hostname.endsWith(".runwayml.com") ||
      parsed.hostname.endsWith(".runwayml.cloud")
    )
  )
    throw new Error(
      "Provider returned an unsupported media host. Download it through your provider account and import it.",
    );
  const temp = path.join(root, "tmp", assetId + "-" + id()),
    prepared = temp + ".mp4";
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok || !response.body)
      throw new Error("Generated media download failed; retry retrieval.");
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > 500 * 1024 * 1024)
          throw new Error("Generated media exceeds 500 MB");
        await handle.write(part);
      }
    } finally {
      await handle.close();
    }
    const source = await probe(temp);
    if (source.kind !== "video")
      throw new Error("Provider returned audio instead of video");
    await normalizeUpload(temp, prepared, "video");
    await probe(prepared);
    await fs.rename(prepared, destination);
    return await record();
  } finally {
    await fs.rm(temp, { force: true });
    await fs.rm(prepared, { force: true });
  }
}
