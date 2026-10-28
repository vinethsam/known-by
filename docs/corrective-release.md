# October 28, 2026 corrective release — frontend validation

The existing research and Database screens now share field formatting, evidence details, review indicators and the results table. No new runtime dependency was added, and the loading orb's implementation, size and animation were left unchanged.

## Confirmed causes and corrections

- **Tall status pills:** the broad `.evidence-stat span` rule changed the shared pill from flex to block. The rule now targets only direct statistic labels. Pills keep icon and text on one horizontal line, with the existing colors. Browser measurement confirms a 23px height, aligned centers and no overflow.
- **False empty results:** terminal job status arrived before the result request completed. Explicit loading, ready, empty and error states now cover that gap. Requests are deduplicated per job. A first empty response is confirmed; retries stop after at most three requests. Known nonempty jobs that still return no rows show a retryable availability error instead of a false empty state.
- **Missing save action:** visibility required a perfectly completed job. `Save to Database` now also accepts terminal partial jobs with at least one useful successful/reviewed person result, matching the backend eligibility check. Pending requests and already saved format combinations prevent duplicate saves. Persistence uses the existing real library API and explicit user action.
- **Failed research hid input:** profile, cards, table and details now use the backend's supplied-field fallback when no research result exists. Input certainty is labeled separately from research confidence. Raw supplied text is preserved in details while canonical display values come from the backend. Failed and cancelled profiles explicitly retain those outcomes rather than fabricating a review or completed state.
- **Status ambiguity:** a partial batch whose counts show every person finished is labeled `Completed with Issues`. Person outcomes and education-record outcomes remain separate. Historical professional affiliations are labeled historical in field details.
- **Saved-file viewing:** Database files open a paginated, searchable preview using the existing table and evidence drawer. Per-field confidence, provenance, review reasons and sources are retained when present. Legacy missing review columns fall back to known confidence/provenance rules. Whole-record source URLs are identified separately and are never fabricated as support for each field.
- **Spacing and mobile layout:** shared details use compact cards and consistent gaps; long values wrap in details. Preview controls use the existing dark theme. Row outcome labels do not wrap internally. The horizontally scrollable table keeps the page within a 390px viewport.

## Validation

- `npm test`: **54 passed, 0 failed, 0 skipped**. Includes rendering of all eight fields, failed-result seed fallback, canonical casing consistency, provenance distinctions, historical labels, partial-job save visibility, rejection of unfinished or result-less payloads, result hydration races, bounded retries, saved legacy fields, request paths, authorization errors and development proxy route restrictions.
- `npm run build`: successful production build. Vite retains its existing warning about the large graphics bundle; the orb was not changed to address an unrelated size warning.
- `tests/browser_corrective_release.py`: successful offline browser workflow using the real Vite app and installed Chrome. All API responses are controlled fixtures, and external requests are blocked. The browser test is separate from the backend's real storage/API integration tests.
- Browser flow covers completed-with-issues research, an initial empty result response followed by valid rows without an empty-state flash, exactly **2 result fetches**, a single save request, saved file listing, preview, pagination from rows 1–50 to row 51, field inspection, searching with no matches and reset, unchanged original-download handling, return to file listing, confirmed deletion with exactly **1 delete request**, and an authorization error.
- Desktop and 390×844 mobile screenshots were visually inspected. Automated measurements also confirm that the dialog and document do not overflow horizontally. Badge centers align with a **0px difference**.
- Saved values use React text rendering. Regression tests confirm script-like text is escaped and both field-level and whole-record sources reject `javascript:` and `data:` links while retaining valid HTTPS links.

## Reproduction

Run the JavaScript checks with `npm test` and `npm run build`. On the validated workstation, run the browser check using the backend virtual environment:

```powershell
& '..\knownby-backend\.venv\Scripts\python.exe' tests/browser_corrective_release.py
```

The browser check requires an existing Playwright installation and Chrome, or a browser executable specified by `KNOWNBY_TEST_BROWSER`. It adds no frontend package dependency. It writes screenshots to ignored `.qa/corrective-release/`:

- `desktop-field-details.png`
- `mobile-field-details.png`
- `mobile-saved-records.png`

## Limits

The frontend browser checks use offline fixtures, not paid research providers or a live deployed backend. They establish rendering and interaction behavior; backend API/storage tests establish persistence, authorization and CSV/XLSX parsing. Original saved files remain server-owned artifacts, and the browser receives only the requested page. Older artifacts cannot recover field evidence or provenance they never stored; the UI presents those details as unavailable rather than inventing them. Deployment verification is recorded in the integrated backend release report.
