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
- Studio CI passed Node 22 and 24 across Linux, macOS and Windows at commit 7e95c156. The next UI-confirmation change must receive its own final CI result.
- A narrow viewport check found no horizontal page overflow. The new-project dialog closes with Escape.
- An isolated recovery test exposed a native browser-confirmation automation failure. The recovery confirmation now uses an in-app checkbox; this revised control still needs a real UI retest.

## Remaining required gates

- Configure a live video-provider account and generate several actual shots from the UI. Confirm the resulting clips attach correctly, survive restart, can be edited with audio, and render into a downloadable final MP4.
- Verify provider failure/recovery and ambiguous-submission recovery controls in the UI.
- Run the final source commit's platform CI, clean installation and credential/package audit.
- Complete the final UI pass for validation, conflicting edits, responsive layout and keyboard accessibility.
- Push the final code and prepare the full-package release artifact with accurate supported-platform instructions.

No ready-for-production claim should be made from the synthetic-media or simulated-provider tests alone.
