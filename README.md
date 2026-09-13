# KnownBy

Internal people research and file enrichment frontend. The product name is provisional; the existing wordmark and branding are configured in `src/App.jsx`.

## Run locally

Use Node.js 20.19+ or 22.12+ and npm:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. `npm run build` creates the production build in `dist`; `npm run preview` serves it locally.

## Structure

The existing React + Vite setup is retained, with plain CSS, Lucide icons, and locally bundled Manrope. No new dependencies or services are needed.

- `src/App.jsx`: Research and History views, local file selection, request state, structured loading results, and field evidence drawer.
- `src/data.js`: the seven shared research field definitions. No fabricated people, scores, or sources.
- `src/styles.css`: layered dark indigo surfaces, responsive composition, and reduced-motion-aware skeleton loading.
- `public/KB_dark-text.svg`: unchanged supplied wordmark, with transparent margins clipped in CSS. It is the only logo asset rendered.

## Current behavior

- Initial Research and History views are empty. No request runs on page load.
- A name and optional organisation initiate a person request. Selecting a CSV/XLSX and pressing Enrich file initiates a file request. Only file metadata is used; contents are never read, parsed, or uploaded.
- Results remain in a skeleton state. Person results show all seven fields together; file results show seven columns with structural row placeholders that do not indicate an actual record count.
- Each field independently opens a drawer containing pending value, confidence, review status, and evidence sections. There are no fabricated claims or evidence-category filters.
- Cancel clears the active loading state. History contains only requests explicitly initiated in the current browser session, with Pending or Cancelled status. It resets on refresh.
- Export remains disabled while no real results exist.

There is no backend integration, real research, queue, confidence calculation, persistence, or export logic. The loading state intentionally waits for a future service integration; it never transitions to fabricated results. All fonts and branding are served locally, and the application makes no external API calls.

## Validation

Run `npm run build`. Check empty startup, input validation, CSV/XLSX selection and replacement/removal, persistent person/file skeletons, all seven field labels, contextual evidence and keyboard focus restoration, cancellation, session history, disabled export, and responsive layout. File results scroll within their panel on smaller screens to preserve readable columns.
