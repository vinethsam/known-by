# KnownBy

Internal people research and file enrichment frontend.

## Run locally

Use Node.js 20.19+ or 22.12+ and npm. Local development and GitHub Pages
both use Google Sign-In and default to the public KnownBy Railway API.
An alternate backend can be set with `BACKEND_API_URL` in `.env.local`
(`VITE_BACKEND_API_URL` is also accepted). Use an HTTPS API base URL.
Railway returns the public Google client ID through `/v1/auth/config`,
verifies each Google credential and enforces its approved-email allowlist.
Keep Google client secrets and server API tokens out of the frontend environment.

```sh
npm install
npm run dev
```

Open `http://localhost:5173/known-by/`, select **Account**, and choose
**Continue with Google**. Use an approved account and open **Database** to
verify access without starting research. Navigate between pages in the same
tab to check that the session stays active. Refreshing, opening a new tab,
signing out, or reaching credential expiry requires signing in again.

The Google Web client's **Authorized JavaScript origins** should include
`https://vinethsam.github.io`, `http://localhost`, and
`http://localhost:5173`. Railway CORS must include
`https://vinethsam.github.io` and `http://localhost:5173`. These settings
use origins without a path. Use `localhost` as documented, since
`127.0.0.1` is a separate origin. [Google Sign-In setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

`npm run build` creates the production build in `dist`. The Pages workflow
checks the emitted API root and mocked request destinations.

## Research flow

Person and CSV/XLSX requests create backend jobs. The frontend checks job
status every 2.5 seconds, stops at a terminal state, and then displays the
backend result. Profile values, confidence, coverage, evidence, alternatives,
conflicts, and review codes come directly from that result. CSV and XLSX
exports are downloaded from the backend.

The shared field configuration displays Full Name,
Organisation, Job Title, University Name, Degree Type, Subject, and Profile
Link in that order across person results, batch tables, and loading states.
The main table shows research confidence and explicit field Review indicators
beneath values inside the same seven columns. Input certainty never substitutes
for research confidence; full provenance remains available in field details.
CSV/XLSX downloads contain the seven values, six research
confidence scores and Source URLs, including downloads of historical records.

History is kept for the current browser session only.

## Shared Library

Completed research can be saved with **Save to Library** beside the CSV and
XLSX export buttons. Choose CSV or XLSX to retain a copy through the existing
library API. A confirmation links to Database, and the action prevents repeated saves
for the same job and format in the current session. Deleting that saved entry enables
adding it again. The Database tab shows the team's shared saved files, with download and
confirmed delete actions. File names and saved dates come from the backend;
compact rows always show the saver identity supplied by the backend, or
Unknown when unavailable. The current shared-token backend does not identify
individual savers; the frontend never infers saver identity from the browser.
Library requests and downloads use the same authenticated transport as research.
Google members receive no additional delete privileges.

## Startup and account UI

The app opens with a brief Thinking Orbs startup card over the existing
gradient, then fades into the interface. It never waits on the research
service. Reduced motion uses a paused orb and a shorter transition. Thinking
Orbs is used only at startup, tinted with KnownBy's existing accent color;
research keeps its existing skeleton loader.

The header account button opens Google sign-in and displays the identity
verified by Railway. The short-lived user credential stays in page memory;
refreshing, signing out, expiration or an unauthorized response clears it.
Production research submission prompts for sign-in without automatically
submitting a job afterward. Local development retains its server-held proxy key.

## Validation

Run:

```sh
npm test
npm run build
```

The API tests cover relative proxy paths, person JSON, multipart uploads,
status/results/cancel requests, Shared Library actions, readable backend
errors, binary export filenames, and verified Google credential handling. CI
also checks the emitted production destination and mocked authenticated reads.
