import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
async function api(url, method = "GET", body) {
  const r = await fetch("/api" + url, {
    method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
const duration = (p) => p?.clips.reduce((s, c) => s + c.out - c.in, 0) ?? 0;
const clock = (t) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;
function App() {
  const [projects, setProjects] = useState([]),
    [data, setData] = useState(null),
    [config, setConfig] = useState({}),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [newOpen, setNewOpen] = useState(false),
    [dirty, setDirty] = useState(false),
    [history, setHistory] = useState([]),
    [selected, setSelected] = useState(null),
    [activeShot, setActiveShot] = useState(null),
    [prompt, setPrompt] = useState(""),
    [playing, setPlaying] = useState(false),
    [playIndex, setPlayIndex] = useState(0),
    [time, setTime] = useState(0);
  const modalRef = useRef(null);
  useEffect(() => {
    if (newOpen && modalRef.current && !modalRef.current.open) {
      const previous = document.activeElement;
      modalRef.current.showModal();
      return () => previous?.focus();
    }
  }, [newOpen]);
  const video = useRef(null),
    music = useRef(null),
    dirtyRef = useRef(false),
    projectRef = useRef(null);
  const p = data?.project,
    clips = p?.clips ?? [],
    clip = clips.find((c) => c.id === selected),
    current = clips[playIndex],
    asset = data?.assets.find((a) => a.id === current?.assetId),
    audioAsset = data?.assets.find((a) => a.id === p?.audio?.assetId),
    total = duration(p);
  useEffect(() => {
    dirtyRef.current = dirty;
    projectRef.current = p;
  }, [dirty, p]);
  useEffect(() => {
    if (p)
      setProjects((xs) =>
        xs.map((x) =>
          x.id === p.id ? { ...x, name: p.name, clips: p.clips.length } : x,
        ),
      );
  }, [p?.id, p?.revision]);
  useEffect(() => {
    if (video.current && current && Number.isFinite(current.in))
      video.current.currentTime = current.in;
  }, [current?.id, current?.in, playIndex]);
  useEffect(() => {
    api("/projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
    api("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!p?.id) return;
    const timer = setInterval(async () => {
      try {
        const next = await api("/projects/" + p.id);
        setData((old) => {
          if (dirtyRef.current)
            return { ...old, assets: next.assets, jobs: next.jobs };
          return next;
        });
      } catch (e) {
        setError(e.message);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [p?.id]);
  useEffect(() => {
    const f = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [dirty]);
  useEffect(() => {
    if (!video.current || !current) return;
    video.current.volume = Math.min(1, current.volume);
  }, [current?.volume]);
  useEffect(() => {
    if (!playing) {
      video.current?.pause();
      music.current?.pause();
    } else
      video.current?.play().catch(() => {
        setPlaying(false);
        setError(
          "Preview could not play. Check the media file or reload the project.",
        );
      });
  }, [playing, asset?.id]);
  async function work(label, fn) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  function load(next) {
    setData(next);
    setDirty(false);
    setHistory([]);
    setSelected(next.project.clips[0]?.id ?? null);
    setPlayIndex(0);
    setPlaying(false);
    setTime(0);
    setActiveShot(null);
  }
  async function open(id) {
    if (dirty && !confirm("Discard unsaved timeline changes?")) return;
    await work("Opening project", async () =>
      load(await api("/projects/" + id)),
    );
  }
  function edit(change) {
    setHistory((h) => [...h.slice(-29), structuredClone(p)]);
    setData((d) => ({ ...d, project: change(structuredClone(d.project)) }));
    setDirty(true);
    setPlaying(false);
  }
  async function save() {
    const next = await api("/projects/" + p.id, "PUT", {
      revision: p.revision,
      name: p.name,
      clips: p.clips,
      audio: p.audio,
    });
    setData(next);
    setDirty(false);
    setNotice("Project saved");
    return next;
  }
  async function create(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await work("Planning your scenes", async () => {
      if (dirty) await save();
      const next = await api("/projects", "POST", {
        name: f.get("name"),
        intent: f.get("intent"),
        duration: Number(f.get("duration")),
        provider: f.get("provider"),
      });
      load(next);
      setProjects(await api("/projects"));
      setNewOpen(false);
    });
  }
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await work("Importing and preparing media", async () => {
      const form = new FormData();
      form.append("file", file);
      const next = await api("/projects/" + p.id + "/media", "POST", form);
      setData((d) => ({ ...d, assets: next.assets }));
      setNotice("Media ready. Add it to the timeline from the library.");
    });
  }
  async function add(a) {
    await work("Adding media", async () => {
      let latest = dirty ? await save() : data;
      const next = await api("/projects/" + p.id + "/add-media", "POST", {
        assetId: a.id,
        revision: latest.project.revision,
        ...(activeShot && a.kind === "video" ? { shotId: activeShot } : {}),
      });
      setData(next);
      setSelected(next.project.clips.at(-1)?.id);
      setDirty(false);
    });
  }
  function patchClip(key, value) {
    edit((n) => {
      const c = n.clips.find((c) => c.id === selected);
      c[key] = value;
      return n;
    });
  }
  function reorder(delta) {
    edit((n) => {
      const i = n.clips.findIndex((c) => c.id === selected),
        j = i + delta;
      if (j >= 0 && j < n.clips.length)
        [n.clips[i], n.clips[j]] = [n.clips[j], n.clips[i]];
      return n;
    });
    setPlayIndex(0);
  }
  function seek(global) {
    setTime(global);
    let start = 0;
    for (let i = 0; i < clips.length; i++) {
      const len = clips[i].out - clips[i].in;
      if (global < start + len || i === clips.length - 1) {
        setPlayIndex(i);
        if (video.current && i === playIndex)
          video.current.currentTime =
            clips[i].in + Math.min(len, global - start);
        break;
      }
      start += len;
    }
  }
  function syncAudio(global) {
    if (!music.current || !p.audio) return;
    const a = p.audio,
      local = global - a.start + a.in;
    if (local < a.in || local >= a.out) {
      music.current.pause();
      return;
    }
    if (Math.abs(music.current.currentTime - local) > 0.25)
      music.current.currentTime = local;
    music.current.volume = Math.min(1, a.volume);
    if (playing) music.current.play().catch(() => {});
  }
  function updateTime() {
    if (!video.current || !current) return;
    const offset = clips
        .slice(0, playIndex)
        .reduce((n, c) => n + c.out - c.in, 0),
      now = offset + Math.max(0, video.current.currentTime - current.in);
    setTime(now);
    syncAudio(now);
    if (video.current.currentTime >= current.out - 0.025) {
      if (playIndex < clips.length - 1) setPlayIndex(playIndex + 1);
      else {
        setPlaying(false);
        setTime(total);
      }
    }
  }
  const latestRender = data?.jobs.filter((j) => j.type === "render").at(-1);
  return (
    <div className="studio">
      <header>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
          }}
        >
          <span className="brandmark">S</span>SceneMeld <small>STUDIO</small>
        </a>
        <div className="projectname">
          {p?.name ?? "Your next story starts here"}{" "}
          {p && (
            <span className={dirty ? "unsaved" : "saved"}>
              {dirty ? "Unsaved changes" : "Saved locally"}
            </span>
          )}
        </div>
        <div className="headeractions">
          <button onClick={() => setNewOpen(true)} disabled={!!busy}>
            ＋ New project
          </button>
          {p && (
            <>
              <button
                disabled={!dirty || !!busy}
                onClick={() => work("Saving", save)}
              >
                Save project
              </button>
              <button
                className="primary"
                disabled={!clips.length || !!busy}
                onClick={() =>
                  work("Starting export", async () => {
                    const latest = dirty ? await save() : data;
                    setData(
                      await api("/projects/" + p.id + "/export", "POST", {
                        revision: latest.project.revision,
                      }),
                    );
                  })
                }
              >
                Export MP4 ↗
              </button>
            </>
          )}
        </div>
      </header>
      {(error || notice || busy) && (
        <div
          className={"message " + (error ? "error" : "")}
          role={error ? "alert" : "status"}
        >
          {error || busy || notice}
          <button
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            ×
          </button>
        </div>
      )}
      <div className="workspace">
        <aside className="library">
          <div className="section-title">
            PROJECTS <span>{projects.length}</span>
          </div>
          <nav>
            {projects.map((x) => (
              <button
                className={x.id === p?.id ? "active" : ""}
                key={x.id}
                disabled={!!busy}
                onClick={() => open(x.id)}
              >
                {x.name}
                <small>{x.clips} clips</small>
              </button>
            ))}
          </nav>
          {p && (
            <>
              <div className="section-title">
                MEDIA LIBRARY{" "}
                <label className="file-button">
                  ＋ Import
                  <input
                    type="file"
                    accept="video/*,audio/*"
                    onChange={upload}
                    disabled={!!busy}
                  />
                </label>
              </div>
              <p className="hint">Video and audio stay on this computer.</p>
              {data.assets.map((a) => (
                <article className="asset" key={a.id}>
                  {a.kind === "video" ? (
                    <video
                      muted
                      preload="metadata"
                      src={"/api/media/" + a.id}
                    />
                  ) : (
                    <div className="audio-symbol">♫</div>
                  )}
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.kind} · {clock(a.duration)}
                    </small>
                  </div>
                  <button
                    onClick={() => add(a)}
                    disabled={!!busy}
                    aria-label={"Add " + a.name}
                  >
                    ＋
                  </button>
                </article>
              ))}
              {!data.assets.length && (
                <div className="empty-small">
                  Import a clip or generate a shot to begin editing.
                </div>
              )}
            </>
          )}
          <div className="connections">
            <span className={config.planning ? "dot on" : "dot"} />
            OpenAI planning{" "}
            <small>{config.planning ? "Connected" : "Not configured"}</small>
            <br />
            <span className={config.video ? "dot on" : "dot"} />
            Runway video{" "}
            <small>{config.video ? "Connected" : "Key needed"}</small>
            <br />
            <span className={config.ffmpeg ? "dot on" : "dot"} />
            Local export{" "}
            <small>{config.ffmpeg ? "Ready" : "FFmpeg missing"}</small>
          </div>
        </aside>
        <main>
          <div className="viewer-top">
            <span>PROGRAM PREVIEW</span>
            <span>1280 × 720 · 30 fps</span>
          </div>
          <div className="viewer">
            {asset ? (
              <video
                ref={video}
                src={"/api/media/" + asset.id}
                playsInline
                onError={() =>
                  setError(
                    "Preview could not load this clip. Reimport the media file.",
                  )
                }
                onLoadedMetadata={() => {
                  const offset = clips
                    .slice(0, playIndex)
                    .reduce((s, c) => s + c.out - c.in, 0);
                  video.current.currentTime =
                    current.in +
                    Math.max(
                      0,
                      Math.min(time - offset, current.out - current.in),
                    );
                  video.current.volume = Math.min(1, current.volume);
                  if (playing)
                    video.current.play().catch(() => {
                      setPlaying(false);
                      setError(
                        "Preview could not play. Check the media file or reload the project.",
                      );
                    });
                }}
                onTimeUpdate={updateTime}
                onEnded={() => {
                  if (playIndex < clips.length - 1) setPlayIndex(playIndex + 1);
                  else setPlaying(false);
                }}
              />
            ) : (
              <div className="welcome">
                <span className="frame-icon">▤</span>
                <h1>Shape every scene.</h1>
                <p>
                  {p
                    ? "Your plan is ready. Generate a shot or import footage, then add it to the timeline."
                    : "Turn your idea into scenes, generate footage, and make the final cut."}
                </p>
                {!p && (
                  <button className="primary" onClick={() => setNewOpen(true)}>
                    Create your first project →
                  </button>
                )}
              </div>
            )}
            {audioAsset && (
              <audio ref={music} src={"/api/media/" + audioAsset.id} />
            )}
          </div>
          <div className="transport">
            <button
              aria-label="Go to start"
              disabled={!clips.length}
              onClick={() => {
                setPlaying(false);
                seek(0);
              }}
            >
              ↤
            </button>
            <button
              className="play"
              disabled={!clips.length}
              onClick={() => {
                if (time >= total) seek(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "Pause" : "Play"} {playing ? "Ⅱ" : "▶"}
            </button>
            <span className="timecode">
              {clock(time)} <em>/ {clock(total)}</em>
            </span>
            <span className="preview-label">Timeline preview</span>
          </div>
          <div className="timeline">
            <div className="timeline-title">
              <strong>Timeline</strong>
              <span>
                {clips.length} clips · {clock(total)}
              </span>
              <button
                disabled={!history.length}
                onClick={() => {
                  const prev = history.at(-1);
                  setData((d) => ({
                    ...d,
                    project: { ...prev, revision: d.project.revision },
                  }));
                  setHistory((h) => h.slice(0, -1));
                  setDirty(true);
                  setPlaying(false);
                }}
              >
                ↶ Undo
              </button>
            </div>
            <input
              className="scrubber"
              type="range"
              aria-label="Timeline position"
              min="0"
              max={total || 1}
              step="0.05"
              value={Math.min(time, total)}
              onChange={(e) => {
                setPlaying(false);
                seek(Number(e.target.value));
              }}
              disabled={!clips.length}
            />
            <div className="track">
              <span className="track-label">
                V1
                <br />
                VIDEO
              </span>
              <div className="clips">
                {clips.map((c, i) => (
                  <button
                    key={c.id}
                    className={"clip " + (selected === c.id ? "selected" : "")}
                    style={{ minWidth: Math.max(115, (c.out - c.in) * 24) }}
                    onClick={() => {
                      setSelected(c.id);
                      setPlayIndex(i);
                      setTime(
                        clips.slice(0, i).reduce((n, c) => n + c.out - c.in, 0),
                      );
                      setPlaying(false);
                    }}
                  >
                    <strong>
                      {String(i + 1).padStart(2, "0")} · {c.title}
                    </strong>
                    <small>{clock(c.out - c.in)}</small>
                  </button>
                ))}
                {!clips.length && (
                  <div className="timeline-empty">
                    Your clips will appear here
                  </div>
                )}
              </div>
            </div>
            <div className="track audio-track">
              <span className="track-label">
                A1
                <br />
                AUDIO
              </span>
              {p?.audio ? (
                <div className="audio-clip">
                  ♫ {audioAsset?.name} · {clock(p.audio.out - p.audio.in)}
                </div>
              ) : (
                <div className="timeline-empty">
                  Import an audio file to add a soundtrack
                </div>
              )}
            </div>
          </div>
          {latestRender && (
            <div className="render-status">
              <strong>MP4 export</strong>
              <span>
                {latestRender.status} · project revision {latestRender.revision}
              </span>
              {latestRender.error && (
                <span role="alert">{latestRender.error}</span>
              )}
              {latestRender.status === "completed" && (
                <a
                  className="button primary"
                  href={"/api/exports/" + latestRender.id}
                >
                  Download MP4 ↓
                </a>
              )}
            </div>
          )}
        </main>
        <aside className="inspector">
          {p ? (
            <>
              <div className="section-title">
                DIRECTOR PLAN <span>{p.shots.length} shots</span>
              </div>
              <div className="shot-list">
                {p.shots.map((s, i) => (
                  <button
                    key={s.id}
                    className={"shot " + (activeShot === s.id ? "active" : "")}
                    onClick={() => {
                      setActiveShot(s.id);
                      setPrompt(s.prompt);
                    }}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{s.title}</strong>
                      <small>
                        {s.sceneTitle} · {s.duration.toFixed(1)}s planned
                      </small>
                    </div>
                  </button>
                ))}
              </div>
              {activeShot && (
                <div className="panel">
                  <label>
                    Shot prompt
                    <textarea
                      aria-label="Shot prompt"
                      rows="5"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      maxLength={1000}
                    />
                  </label>
                  <p className="hint">
                    Runway generates a 5-second clip. Uses your provider
                    credits. The clip is saved and linked to this shot.
                  </p>
                  <button
                    className="primary full"
                    disabled={!!busy || !config.video || !prompt.trim()}
                    onClick={() =>
                      work("Submitting generation", async () => {
                        if (dirty) await save();
                        setData(
                          await api("/projects/" + p.id + "/generate", "POST", {
                            shotId: activeShot,
                            prompt,
                          }),
                        );
                      })
                    }
                  >
                    Generate 5s video ✦
                  </button>
                  {!config.video && (
                    <p className="hint">
                      A Runway API key is needed for generation.
                    </p>
                  )}
                </div>
              )}
              {clip && (
                <div className="panel">
                  <div className="section-title">CLIP INSPECTOR</div>
                  <label>
                    Clip title
                    <input
                      value={clip.title}
                      onChange={(e) => patchClip("title", e.target.value)}
                    />
                  </label>
                  <div className="fields">
                    <label>
                      Trim start (s)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={clip.in}
                        onChange={(e) =>
                          patchClip("in", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      Trim end (s)
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={clip.out}
                        onChange={(e) =>
                          patchClip("out", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Clip volume
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={clip.volume}
                      onChange={(e) =>
                        patchClip("volume", Number(e.target.value))
                      }
                    />
                  </label>
                  <div className="fields">
                    <button onClick={() => reorder(-1)}>← Earlier</button>
                    <button onClick={() => reorder(1)}>Later →</button>
                  </div>
                  <button
                    className="danger full"
                    onClick={() => {
                      edit((n) => ({
                        ...n,
                        clips: n.clips.filter((c) => c.id !== selected),
                      }));
                      setSelected(null);
                      setPlayIndex(0);
                    }}
                  >
                    Remove from timeline
                  </button>
                </div>
              )}
              {p.audio && (
                <div className="panel">
                  <div className="section-title">SOUNDTRACK</div>
                  {[
                    ["start", "Timeline start (s)"],
                    ["in", "Audio trim start (s)"],
                    ["out", "Audio trim end (s)"],
                    ["volume", "Soundtrack volume"],
                  ].map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        max={k === "volume" ? 1 : undefined}
                        value={p.audio[k]}
                        onChange={(e) =>
                          edit((n) => ({
                            ...n,
                            audio: { ...n.audio, [k]: Number(e.target.value) },
                          }))
                        }
                      />
                    </label>
                  ))}
                  <button
                    className="danger full"
                    onClick={() => edit((n) => ({ ...n, audio: null }))}
                  >
                    Remove soundtrack
                  </button>
                </div>
              )}
              {data.jobs
                .filter((j) => j.type === "video")
                .map((j) => (
                  <div className="job" key={j.id}>
                    <strong>Video generation · {j.status}</strong>
                    {j.error && <p>{j.error}</p>}
                    {j.remoteId && <p>Provider task: {j.remoteId}</p>}
                    {j.status === "uncertain" && (
                      <>
                        <p>
                          Check your Runway account. Reconnect the existing task
                          to continue without paying for another generation.
                        </p>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const remoteId = new FormData(e.currentTarget).get(
                              "remoteId",
                            );
                            work("Reconnecting generation", async () => {
                              const next = await api(
                                "/jobs/" + j.id + "/reconcile",
                                "POST",
                                { remoteId },
                              );
                              setData((d) => ({ ...d, jobs: next.jobs }));
                            });
                          }}
                        >
                          <label>
                            Provider task ID
                            <input
                              name="remoteId"
                              required
                              placeholder="Task ID from Runway"
                            />
                          </label>
                          <button className="full" disabled={!!busy}>
                            Reconnect generation
                          </button>
                        </form>
                        <button
                          className="full danger"
                          disabled={!!busy}
                          onClick={() => {
                            if (
                              confirm(
                                "Have you verified in Runway that this request created no generation task? Only confirm after checking to avoid a duplicate charge.",
                              )
                            )
                              work("Updating job status", async () => {
                                const next = await api(
                                  "/jobs/" + j.id + "/reconcile",
                                  "POST",
                                  { confirmedNotSubmitted: true },
                                );
                                setData((d) => ({ ...d, jobs: next.jobs }));
                              });
                          }}
                        >
                          I verified no task was created
                        </button>
                      </>
                    )}
                  </div>
                ))}
              <details>
                <summary>Plan continuity · {p.continuity.length} notes</summary>
                {p.continuity.map((x, i) => (
                  <p key={i}>{x.message}</p>
                ))}
                <a href={"/api/projects/" + p.id + "/director"}>
                  Download Director plan
                </a>
              </details>
            </>
          ) : (
            <div className="empty-small">
              <strong>From brief to final cut</strong>
              <p>1. Plan your scenes</p>
              <p>2. Generate or import video</p>
              <p>3. Trim, arrange, add audio</p>
              <p>4. Export a finished MP4</p>
            </div>
          )}
        </aside>
      </div>
      {newOpen && (
        <dialog
          ref={modalRef}
          onCancel={() => setNewOpen(false)}
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-title"
        >
          <div className="modal-header">
            <h2 id="new-title">Start a new story</h2>
            <button
              aria-label="Close new project"
              onClick={() => setNewOpen(false)}
            >
              ×
            </button>
          </div>
          <p>Plan your shots, then bring them to life.</p>
          {error && (
            <p role="alert" className="modal-error">
              {error}
            </p>
          )}
          <form onSubmit={create}>
            <label>
              Project name
              <input
                name="name"
                autoFocus
                required
                maxLength="120"
                placeholder="Lighthouse at dusk"
              />
            </label>
            <label>
              Creative brief
              <textarea
                name="intent"
                required
                minLength="3"
                maxLength="4000"
                rows="4"
                placeholder="A lighthouse beam sweeps over the ocean as a storm approaches…"
              />
            </label>
            <div className="fields">
              <label>
                Target length (seconds)
                <input
                  name="duration"
                  type="number"
                  defaultValue="15"
                  min="5"
                  max="120"
                />
              </label>
              <label>
                Planning provider
                <select
                  name="provider"
                  defaultValue={config.planning ? "openai-byok" : "local-mock"}
                >
                  <option value="openai-byok" disabled={!config.planning}>
                    OpenAI
                  </option>
                  <option value="local-mock">Offline structural draft</option>
                </select>
              </label>
            </div>
            <p className="hint">
              OpenAI receives your brief. Offline mode creates a structural
              draft without AI generation.
            </p>
            <button className="primary full" disabled={!!busy} type="submit">
              {busy || "Create scene plan →"}
            </button>
          </form>
          <label className="file-button import-plan">
            Import an existing Director plan
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                work("Importing plan", async () => {
                  if (f.size > 10 * 1024 * 1024)
                    throw new Error("Plan exceeds 10 MB");
                  load(
                    await api(
                      "/import-director",
                      "POST",
                      JSON.parse(await f.text()),
                    ),
                  );
                  setProjects(await api("/projects"));
                  setNewOpen(false);
                });
              }}
            />
          </label>
        </dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
