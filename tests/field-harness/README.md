# Field GC workflow browser harness

Run `node tests/field-harness/serve.mjs` and open `http://127.0.0.1:4181`.
This renders the production Field GC dashboard and project board against a
local, persistent service double. It never contacts the production backend or
creates accounts. Authorization, account-free links, uploads, and review transitions
are tested against real Convex functions in `convex/field.test.ts`.

The sample project opens directly without signing in. Upload a PNG/JPEG, upload a photo for each scheduled work item, complete both field requirements,
and submit the stage. Open `http://127.0.0.1:4181/?office=1` to review its activity,
verify the construction, request corrections, and update office requirements.
Check desktop and phone widths. Clear the `sah-helper:field-filtered-draw-schedule-test`
localStorage key to reset the fixture.

Use `?fail-upload=once` on the sample field URL to simulate a failed request.
The first photo upload fails; Retry uploads the retained photo without asking
for another selection. Browser refresh clears unsaved selections. Camera
capture and HEIC conversion depend on the phone/browser and should also be
checked on a physical iPhone and Android before rollout.
