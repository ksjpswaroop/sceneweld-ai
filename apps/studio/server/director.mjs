import { planIntent } from "director-mcp/dist/director/plan.js";
import { setProvider } from "director-mcp/dist/ai/registry.js";
import { planStore } from "director-mcp/dist/director/store.js";
import { compilePrompts } from "director-mcp/dist/director/compile.js";
import { parseProject } from "director-mcp/dist/director/schema.js";
import { checkContinuity } from "director-mcp/dist/director/continuity.js";
import { id } from "./store.mjs";
let queue = Promise.resolve();
export function fromDirector(raw) {
  const plan = parseProject(raw.directive ?? raw);
  planStore.put(plan);
  try {
    const compiled = compilePrompts({
      projectId: plan.projectId,
      model: "generic",
    });
    return {
      id: id(),
      revision: 0,
      name: plan.name,
      createdAt: new Date().toISOString(),
      director: plan,
      shots: plan.scenes.flatMap((scene) =>
        scene.shots.map((shot) => ({
          id: shot.shotId,
          sceneId: scene.sceneId,
          title: shot.subject || scene.title,
          duration: shot.durationSec,
          prompt:
            compiled.shots.find((s) => s.shotId === shot.shotId)?.prompt ?? "",
          sceneTitle: scene.title,
        })),
      ),
      clips: [],
      audio: null,
      continuity: checkContinuity({ projectId: plan.projectId }).issues,
    };
  } finally {
    planStore.clear();
  }
}
export function createPlan(input) {
  const task = queue.then(async () => {
    setProvider({ provider: input.provider });
    try {
      const p = await planIntent({
        intent: input.intent,
        name: input.name,
        durationSec: input.duration,
        targetModel: "generic",
      });
      return fromDirector(p);
    } finally {
      planStore.clear();
    }
  });
  queue = task.catch(() => {});
  return task;
}
