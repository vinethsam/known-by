# KnownBy

Internal research and file enrichment application; frontend. App name is provisional.

## Run locally

Use Node.js 20.19+ or 22.12+ and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates the production build in `dist`; `npm run preview` serves it locally.

## Current behavior

There is no backend integration, research engine, queue, confidence calculation, persistence, or export logic. The loading state intentionally waits for a future backend integration; it never transitions to fabricated results. All fonts and branding are served locally, and for the time being, the application makes no external API calls.

## Validation

Run `npm run build`. Check empty startup, input validation, CSV/XLSX selection and replacement/removal, persistent person/file skeletons, all seven field labels, contextual evidence and keyboard focus restoration, cancellation, session history, disabled export, and responsive layout. File results scroll within their panel on smaller screens to preserve readable columns.
