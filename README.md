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

History is kept for the current browser session only.

## Shared Library

Completed research can be saved explicitly as CSV or XLSX from the Research
page. The Database tab shows the team's shared saved files, with download and
confirmed delete actions. File names and saved dates come from the backend;
the page shows a saver name only if the backend supplies one. Library requests
use the same authenticated `/api/*` proxy as research requests.

## Validation

Run:

```sh
npm test
npm run build
```

The API tests cover relative proxy paths, person JSON, multipart uploads,
status/results/cancel requests, Shared Library actions, readable backend
errors, and binary export filenames.
