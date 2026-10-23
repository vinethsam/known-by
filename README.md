# KnownBy

Internal people research and file enrichment frontend.

## Run locally

Use Node.js 20.19+ or 22.12+ and npm. First copy the two values from
`.env.example` into `.env.local`:

```dotenv
BACKEND_API_URL=https://your-railway-backend.example
BACKEND_API_TOKEN=your-api-access-token
```

The variables deliberately do not use a `VITE_` prefix. They are read only by
the Vite development server, which adds the bearer token while proxying
browser requests from `/api/*` to the configured backend.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates the production build in `dist`; `npm run preview` serves it locally.

## Research flow

Person and CSV/XLSX requests create backend jobs. The frontend checks job
status every 2.5 seconds, stops at a terminal state, and then displays the
backend result. Profile values, confidence, coverage, evidence, alternatives,
conflicts, and review codes come directly from that result. CSV and XLSX
exports are downloaded from the backend.

The shared field configuration displays Full Name, Country of Origin,
Organisation, Job Title, University Name, Degree Type, Subject, and Profile
Link in that order across person results, batch tables, and loading states.
Country confidence and evidence use the same field details as every other
field. Older results without a country remain supported and show Not found.

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
individual savers; the frontend never infers identity from the browser. Library requests
use the same authenticated `/api/*` proxy as research requests.

## Startup and account UI

The app opens with a brief Thinking Orbs startup card over the existing
gradient, then fades into the interface. It never waits on the research
service. Reduced motion uses a paused orb and a shorter transition. Thinking
Orbs is used only at startup, tinted with KnownBy's existing accent color;
research keeps its existing skeleton loader.

The header account button opens the signed-out account dialog. Google sign-in
is visibly unavailable until a real authentication backend is connected.
There are no simulated sessions, user profiles, or OAuth requests. The dialog
is isolated in `src/account/AccountDialog.jsx` for future integration.

## Validation

Run:

```sh
npm test
npm run build
```

The API tests cover relative proxy paths, person JSON, multipart uploads,
status/results/cancel requests, Shared Library actions, readable backend
errors, and binary export filenames.
