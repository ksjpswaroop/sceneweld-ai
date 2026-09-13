# Full-package release gates

Status: implementation in progress, not yet production released.

## Evidence collected

- Live OpenAI planning through the real Studio browser form produced three five-second lighthouse shots.
- Real browser file-picker import of two synthetic video fixtures and an audio fixture passed. Synthetic fixtures test editing and export; they are not AI-generated video evidence.
- Real UI trimming from 0.5 to 2.5 seconds, reordering clips, adding audio and saving passed.
- Studio server restart and browser reload preserved the timeline order, trim values and soundtrack.
- Real browser playback decoded the media and advanced through the timeline; the final time was five seconds.
- Real UI Export MP4 reached completed and the Download MP4 link triggered a browser download.
- A media-serving defect found through the browser was fixed: only known media/export paths explicitly allow access beneath the hidden local data directory.
- Automated real HTTP and FFmpeg tests cover media range requests, stale-save rejection, export decoding, duration, first-frame order, persistence and server restart.
- Runway adapter and job tests cover request shape, safe errors, transient retrieval failure, shot linkage and duplicate completion. These use simulated provider responses.

- A clean install from the committed source archive built and passed all seven tests.
- The portable tarball installed without development dependencies and passed the real HTTP import/edit/export/restart test against its own server.
- The tarball and nested Director archive passed a scan for private state files and the configured credential values.
- Studio CI passed Node 22 and 24 across Linux, macOS and Windows at commit 7e95c156. Final packaging and conflict-recovery changes receive their own CI runs.
- A narrow viewport check found no horizontal page overflow. The new-project dialog closes with Escape.
- The revised in-app recovery checkbox passed in an isolated browser fixture: the simulated uncertain submission changed to failed without a provider request.
- Invalid trim ranges were rejected through the UI; Undo restored the valid edit and saving succeeded.
- Two real browser windows verified stale-save rejection and explicit reload recovery, preserving the newer saved edit.

## Remaining required gates

- Configure a live video-provider account and generate several actual shots from the UI. Confirm the resulting clips attach correctly, survive restart, can be edited with audio, and render into a downloadable final MP4.
- Verify reconnection to an actual existing provider task once video credentials are available. The simulated ambiguous-submission UI recovery has passed.
- Run the final source commit's platform CI, clean installation and credential/package audit.
- Repeat the final plan-to-generated-video UI workflow against the release package with live provider credentials. Validation, conflicting edits, narrow layout and modal keyboard checks have passed.
- Push final live-generation fixes, rerun the required checks and publish the verified full-package artifact. A portable candidate and installation instructions are prepared.

No ready-for-production claim should be made from the synthetic-media or simulated-provider tests alone.
