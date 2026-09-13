# SceneMeld Studio

One local application for Director planning, video generation, timeline editing and MP4 export. This is the full-workflow implementation under development. **Do not call the release production-verified until the remaining gates in VERIFICATION.md pass.**

## Run

Install Node.js 22.12+ and FFmpeg (including ffprobe). From this directory:

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4317. The browser and server run on the same computer. Studio binds to loopback and refuses foreign browser origins and hostnames. This is a single-user local application; it is not configured for public Internet hosting.

Save provider credentials in an ignored `.env.local` in this directory:

```env
OPENAI_API_KEY=replace-with-your-key
RUNWAYML_API_SECRET=replace-with-your-key
```

`npm start` reads that file. Restart after changing credentials. To reuse an existing file elsewhere without copying its secrets:

```sh
node --env-file=/absolute/path/to/existing/.env.local server/index.mjs
```

Keys remain on the server. OpenAI receives your creative brief; Runway receives the shot prompt when you click Generate. Generation uses your provider credits. The UI reports whether credentials are configured; live access also depends on your account, credits and model availability.

## Workflow

1. Create a project with a brief and target duration. Choose OpenAI for creative planning or the explicitly labeled offline structural draft. You can also import a Director JSON export.
2. Select a shot and review its prompt. Generate a five-second Runway Gen-4.5 clip, or import an existing video. Generated clips attach to the source shot and timeline; imported media is added with its + button. Selecting a shot before adding media links it to that shot.
3. Click a timeline clip. Set its trim start and end, adjust volume, or move it earlier/later. Undo restores recent local timeline edits. Click Save project to persist changes. Media additions save immediately.
4. Import audio and add it as a soundtrack. Adjust its offset, trim and volume. Preview plays the timeline and soundtrack.
5. Export MP4. Export uses a saved snapshot of the timeline, so subsequent edits do not change an in-progress render. Download the completed file from the export panel.

The first workflow supports sequential cuts, one soundtrack, up to 100 clips / ten minutes, 500 MB per import, and 1280×720 H.264/AAC MP4 at 30 fps. Imported media is normalized for browser playback. Aspect ratios are preserved with letterboxing. There are no transitions or overlays in this first workflow.

## Persistence and recovery

Data lives in `~/.scenemeld-studio`; override `SCENEMELD_DATA_DIR` to use another directory. Projects, media and exports remain local. Back up the entire directory with the server stopped; a Director JSON export preserves planning data but does not contain timeline edits or video/audio files.

State writes validate the document and use an atomic temporary-file replacement. Conflicting saves return an error rather than overwriting a newer edit. Use Discard my edits and reload to keep the newer saved version after a conflict, then reapply any intended edits. There is no silent state migration or corrupt-file reset.

One server owns a data directory at a time. A normal shutdown releases `server.lock`. After an uncatchable crash, verify the PID in that file no longer belongs to a running Studio process before removing the lock. Never remove a live server's lock.

Interrupted exports are marked failed after restart; run Export again from the saved timeline. Submitted video jobs with a saved provider ID resume polling after restart without submitting another paid generation. Ambiguous interrupted submissions are marked uncertain and are not retried automatically. Check the Runway account before generating again. For an uncertain job, use Reconnect generation with the provider task ID, or explicitly confirm that no task was created. Reconnecting only retrieves the existing task; it does not submit a new paid request. Provider output is downloaded locally; signed provider URLs are not exposed in the UI or saved in the project.

## Development and tests

```sh
npm run format:check
npm test
npm run build
npm audit --audit-level=moderate
```

Tests use real local FFmpeg and isolated data directories. Runway contract/job tests use simulated provider responses; they do not prove live provider access. See VERIFICATION.md for actual UI evidence and remaining release gates.

Director 0.2.0 is vendored as an installable package in `vendor/`, built from ksjpswaroop/scenemeld-director commit 02a18beb60126e36762bf78ae5cab8726ac8df69. It contains no credentials. Existing OpenCut scaffold applications remain in the repository; `apps/studio` is the runnable full-workflow surface.

## Provider references

- https://docs.dev.runwayml.com/guides/using-the-api/
- https://docs.dev.runwayml.com/assets/outputs/
- https://developers.openai.com/api/docs/deprecations

OpenAI Sora/Videos API is scheduled to shut down September 24, 2026. Studio uses OpenAI for planning and a separate provider for video generation.

## Portable package

The release tarball includes the built browser UI, server, Director package and license. Extract it, enter its `package` directory, run `npm install --omit=dev`, then `npm start`. Node and FFmpeg are prerequisites. Source checkouts use the build instructions above. The package is not published to the npm registry.
