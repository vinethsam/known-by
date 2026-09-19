import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  FileUp,
  Layers3,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import {
  cancelJob,
  downloadExport,
  getJob,
  getJobResults,
  researchBatch,
  researchPerson,
} from "./api.js";
import { fields } from "./data.js";

const brand = { name: "KnownBy" };
const activeStatuses = new Set(["submitting", "queued", "running"]);
const terminalStatuses = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

const requestType = (request) =>
  request.kind === "person" ? "Person research" : "File enrichment";

const fieldLabel = (field) =>
  fields.find(([key]) => key === field)?.[1] ?? field;

const titleCase = (value = "") =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatPercent = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  return Number.isFinite(Number(value))
    ? `${Math.round(Number(value))}%`
    : "—";
};

const unique = (values) => [...new Set(values.filter(Boolean))];

const errorMessage = (error, fallback) =>
  typeof error?.message === "string" && error.message.trim()
    ? error.message
    : fallback;

const safeHttpUrl = (value) => {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
};

const sourceUrl = (source) =>
  [source?.final_url, source?.canonical_url, source?.requested_url]
    .map(safeHttpUrl)
    .find(Boolean) || "";

function Skeleton({ className = "" }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />;
}

function StatusBadge({ status }) {
  const safeStatus = status || "queued";
  return (
    <span className={`status-badge ${safeStatus}`}>
      {["completed", "review_required"].includes(safeStatus) ? (
        <CheckCircle2 size={13} />
      ) : ["failed", "partial"].includes(safeStatus) ? (
        <AlertCircle size={13} />
      ) : activeStatuses.has(safeStatus) || safeStatus === "researching" ? (
        <RefreshCw className="spin" size={13} />
      ) : (
        <Clock3 size={13} />
      )}
      {titleCase(safeStatus)}
    </span>
  );
}

function EvidenceDrawer({ selection, onClose }) {
  const dialog = useRef(null);
  const { field, person, request, row } = selection;
  const result = person?.result;
  const profile = result?.profile;
  const decision = profile?.fields?.[field];
  const label = fieldLabel(field);

  const evidence = useMemo(() => {
    const claims = result?.claims ?? [];
    const sources = result?.sources ?? [];
    const claimMap = new Map(claims.map((claim) => [claim.claim_id, claim]));
    const sourceMap = new Map(
      sources.map((source) => [source.source_id, source]),
    );
    const supportingIds = unique([
      decision?.selected_claim_id,
      ...(decision?.supporting_claim_ids ?? []),
    ]);
    const supportingClaims = supportingIds
      .map((id) => claimMap.get(id))
      .filter(Boolean);
    const conflictingClaims = (decision?.conflicting_claim_ids ?? [])
      .map((id) => claimMap.get(id))
      .filter(Boolean);
    const alternativeClaims = (decision?.alternative_claim_ids ?? [])
      .map((id) => claimMap.get(id))
      .filter(Boolean);
    const linkedSourceIds = unique([
      ...(decision?.supporting_source_ids ?? []),
      ...supportingClaims.map((claim) => claim.source_id),
      ...conflictingClaims.map((claim) => claim.source_id),
      ...alternativeClaims.map((claim) => claim.source_id),
    ]);

    return {
      supportingClaims,
      conflictingClaims,
      alternativeClaims,
      linkedSources: linkedSourceIds
        .map((id) => sourceMap.get(id))
        .filter(Boolean),
    };
  }, [decision, result]);

  useEffect(() => {
    const panel = dialog.current;
    const trigger = document.activeElement;
    panel?.showModal();
    return () => {
      if (panel?.open) panel.close();
      trigger?.focus();
    };
  }, []);

  function renderClaims(claims, heading) {
    if (!claims.length) return null;
    return (
      <section className="claim-section">
        <h3>{heading}</h3>
        {claims.map((claim) => {
          const source = evidence.linkedSources.find(
            (item) => item.source_id === claim.source_id,
          );
          const url = sourceUrl(source);
          return (
            <article className="claim-card" key={claim.claim_id}>
              <strong>{claim.normalised_value || claim.raw_value}</strong>
              <p>{claim.evidence_text}</p>
              <div className="claim-meta">
                <span>{titleCase(claim.directness)}</span>
                {claim.temporal_context && (
                  <span>{claim.temporal_context}</span>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer">
                    {source?.title || source?.domain || "Open source"}{" "}
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </section>
    );
  }

  return (
    <dialog
      ref={dialog}
      className="source-dialog"
      aria-labelledby="evidence-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer-inner">
        <div className="drawer-top">
          <span className="eyebrow">
            <Layers3 size={16} /> FIELD DETAILS
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close field details"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="field-drawer-heading">
          <h2 id="evidence-title">{label}</h2>
          <p>
            {request.label}
            {row !== undefined && ` · Row ${row}`}
          </p>
        </div>

        {!decision ? (
          <div className="evidence-empty">
            <AlertCircle size={19} />
            <div>
              <strong>No field result</strong>
              <p>
                The backend did not return a decision for this field
                {person?.error_code ? ` (${person.error_code})` : "."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <section className="field-value-card">
              <h3>Selected value</h3>
              {decision.value ? (
                field === "profile_link" && safeHttpUrl(decision.value) ? (
                  <a
                    className="field-value"
                    href={safeHttpUrl(decision.value)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {decision.value} <ExternalLink size={14} />
                  </a>
                ) : (
                  <p className="field-value">{decision.value}</p>
                )
              ) : (
                <p className="field-value missing">Not found</p>
              )}
            </section>

            <div className="evidence-stats">
              <div className="evidence-stat">
                <span>Confidence</span>
                <strong>{formatPercent(decision.confidence)}</strong>
              </div>
              <div className="evidence-stat">
                <span>Review status</span>
                <StatusBadge
                  status={
                    decision.review_required ? "review_required" : "completed"
                  }
                />
              </div>
            </div>

            {decision.review_reason_codes?.length > 0 && (
              <section className="claim-section">
                <h3>Review codes</h3>
                <div className="review-codes">
                  {decision.review_reason_codes.map((code) => (
                    <span className="review-code" key={code}>
                      {titleCase(code)}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {renderClaims(evidence.supportingClaims, "Supporting evidence")}
            {renderClaims(evidence.alternativeClaims, "Alternatives")}
            {renderClaims(evidence.conflictingClaims, "Conflicts")}

            {(evidence.linkedSources.length > 0 ||
              decision.sources?.length > 0) && (
              <section className="claim-section">
                <h3>Sources</h3>
                <div className="source-list">
                  {evidence.linkedSources.map((source) => {
                    const url = sourceUrl(source);
                    if (!url) return null;
                    return (
                      <a
                        className="source-link"
                        href={url}
                        key={source.source_id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>
                          <strong>
                            {source.title || source.domain || "Source"}
                          </strong>
                          <small>
                            {titleCase(source.source_type)}
                            {source.domain ? ` · ${source.domain}` : ""}
                          </small>
                        </span>
                        <ExternalLink size={14} />
                      </a>
                    );
                  })}
                  {unique(decision.sources ?? [])
                    .map(safeHttpUrl)
                    .filter(Boolean)
                    .filter(
                      (url) =>
                        !evidence.linkedSources.some(
                          (source) => sourceUrl(source) === url,
                        ),
                    )
                    .map((url) => (
                      <a
                        className="source-link"
                        href={url}
                        key={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span>
                          <strong>{url}</strong>
                        </span>
                        <ExternalLink size={14} />
                      </a>
                    ))}
                </div>
              </section>
            )}

            {decision.scoring_components &&
              Object.keys(decision.scoring_components).length > 0 && (
                <details className="scoring-details">
                  <summary>Scoring details</summary>
                  <dl>
                    {Object.entries(decision.scoring_components).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>{titleCase(key)}</dt>
                          <dd>
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                </details>
              )}

            {evidence.supportingClaims.length === 0 &&
              evidence.alternativeClaims.length === 0 &&
              evidence.conflictingClaims.length === 0 &&
              evidence.linkedSources.length === 0 &&
              !decision.sources?.length && (
                <div className="evidence-empty compact">
                  <Layers3 size={18} />
                  <p>No supporting evidence was returned for this field.</p>
                </div>
              )}
          </>
        )}
      </div>
    </dialog>
  );
}

function Upload({ file, onFile, onRemove, onStart, busy, actionRef }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function accept(fileList) {
    setDragging(false);
    if (busy) return;
    const picked = fileList?.[0];
    if (!picked) return;
    if (fileList.length > 1) {
      setError("Choose one file at a time.");
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(picked.name)) {
      setError("Choose a CSV or XLSX file.");
      return;
    }
    if (picked.size === 0) {
      setError("This file is empty. Choose a file containing names.");
      return;
    }
    setError("");
    onFile(picked);
  }

  return (
    <section className="workflow-card upload-card" aria-labelledby="upload-title">
      <div className="card-heading">
        <span className="feature-icon">
          <FileSpreadsheet size={23} />
        </span>
        <h2 id="upload-title">Enrich a file</h2>
        <span className="format-label">CSV / XLSX</span>
      </div>
      <p className="workflow-description">
        Upload a CSV or XLSX containing people.
      </p>
      <input
        ref={input}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept=".csv,.xlsx"
        aria-label="Choose a file"
        disabled={busy}
        onChange={(event) => {
          accept(event.target.files);
          event.target.value = "";
        }}
      />
      {file ? (
        <div className="selected-file">
          <span className="file-icon">
            <FileSpreadsheet size={30} />
          </span>
          <div className="selected-file-details">
            <strong title={file.name}>{file.name}</strong>
            <span>
              {file.name.split(".").pop().toUpperCase()} ·{" "}
              {file.size < 1024
                ? `${file.size} bytes`
                : file.size < 1024 * 1024
                  ? `${(file.size / 1024).toFixed(1)} KB`
                  : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
            </span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Remove selected file"
            disabled={busy}
            onClick={() => {
              setError("");
              onRemove();
            }}
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        <div
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            accept(event.dataTransfer.files);
          }}
        >
          <span className="upload-icon">
            <FileUp size={28} />
          </span>
          <div>
            <strong>
              Drop a CSV or XLSX here, or{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => input.current?.click()}
                disabled={busy}
              >
                browse files
              </button>
            </strong>
            <span>Include a full name column</span>
          </div>
        </div>
      )}
      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
      <div className="upload-bottom">
        <div className="file-actions">
          {file && (
            <button
              type="button"
              className="secondary"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              Replace file
            </button>
          )}
        </div>
        <button
          ref={actionRef}
          type="button"
          className="primary"
          onClick={onStart}
          disabled={!file || busy}
        >
          Enrich file <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function JobProgress({ job }) {
  const counts = job.counts;
  if (!counts || !job.totalPeople) return null;
  const processed = ["completed", "review_required", "failed", "cancelled"].reduce(
    (total, key) => total + (Number(counts[key]) || 0),
    0,
  );
  const percentage = Math.min(
    100,
    Math.round((processed / job.totalPeople) * 100),
  );
  return (
    <div className="job-progress" aria-label={`${percentage}% processed`}>
      <span style={{ width: `${percentage}%` }} />
    </div>
  );
}

function ProfileSummary({ person }) {
  const profile = person?.result?.profile;
  const name = profile?.fields?.full_name?.value || profile?.input_name;
  return (
    <div className="profile-summary populated-summary">
      <span className="profile-summary-icon">
        <UserRound size={25} />
      </span>
      <div className="summary-copy">
        <strong>{name || "Person result"}</strong>
        <span>
          {profile?.review_required
            ? "Review recommended"
            : "Research complete"}
        </span>
      </div>
      <div className="summary-stats">
        <div className="profile-stat">
          <span>Profile confidence</span>
          <strong>{formatPercent(profile?.profile_confidence)}</strong>
        </div>
        <div className="profile-stat">
          <span>Coverage</span>
          <strong>{formatPercent(profile?.coverage)}</strong>
        </div>
        <div className="profile-stat">
          <span>Sources used</span>
          <strong>{profile?.sources_used ?? 0}</strong>
        </div>
        <StatusBadge status={person?.status || profile?.status} />
      </div>
    </div>
  );
}

function FieldCard({ field, label, person, request, onSelect }) {
  const decision = person?.result?.profile?.fields?.[field];
  const linkedSourceCount = unique(
    decision?.supporting_source_ids ?? [],
  ).length;
  const sourceCount =
    linkedSourceCount || unique(decision?.sources ?? []).length;
  return (
    <button
      type="button"
      className="result-field populated-field"
      aria-label={`Inspect ${label.toLowerCase()} details`}
      onClick={() => onSelect({ field, request, person })}
    >
      <span className="field-title">
        <span className="field-label-text">{label}</span>
        <Layers3 className="field-evidence-icon" size={16} />
      </span>
      <span
        className={`field-result-value ${decision?.value ? "" : "missing"}`}
        title={decision?.value || undefined}
      >
        {decision?.value || "Not found"}
      </span>
      <span className="field-meta">
        <span>{formatPercent(decision?.confidence)} confidence</span>
        <span className="field-source-count">
          {sourceCount} {sourceCount === 1 ? "source" : "sources"}
        </span>
        {decision?.review_required && (
          <span className="review-dot">Review</span>
        )}
      </span>
    </button>
  );
}

function PersonSkeleton() {
  return (
    <>
      <div className="profile-summary" aria-hidden="true">
        <span className="profile-summary-icon">
          <UserRound size={25} />
        </span>
        <div>
          <Skeleton className="skeleton-value" />
          <Skeleton className="skeleton-short" />
        </div>
      </div>
      <div className="profile-fields" aria-label="Research fields loading">
        {fields.map(([key, label]) => (
          <div className="result-field" key={key}>
            <span className="field-title">
              <span className="field-label-text">{label}</span>
            </span>
            <span className="field-placeholder" aria-busy="true">
              <Skeleton className="skeleton-value" />
              <span className="sr-only">Value pending</span>
            </span>
            <span className="field-meta">
              <Skeleton className="skeleton-confidence" />
              <Skeleton className="skeleton-source" />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function BatchTable({ job, onSelect }) {
  const people = [...(job.results?.people ?? [])].sort(
    (a, b) => (a.row_index ?? 0) - (b.row_index ?? 0),
  );

  if (
    !people.length &&
    activeStatuses.has(job.status) &&
    !job.monitoringStopped
  ) {
    const rows = Math.min(Math.max(job.totalPeople || 4, 1), 4);
    return (
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="File research fields loading"
      >
        <table className="file-results">
          <thead>
            <tr>
              {fields.map(([key, label]) => (
                <th key={key} scope="col">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row}>
                {fields.map(([key]) => (
                  <td key={key}>
                    <div className="skeleton-cell">
                      <Skeleton className="skeleton-value" />
                      <span className="field-meta">
                        <Skeleton className="skeleton-confidence" />
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!people.length) {
    return (
      <div className="terminal-empty">
        <AlertCircle size={22} />
        <h3>No person results were returned</h3>
        <p>{job.error || "The job ended without result rows."}</p>
      </div>
    );
  }

  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="File research results; scroll horizontally for all columns"
    >
      <table className="file-results">
        <thead>
          <tr>
            {fields.map(([key, label]) => (
              <th key={key} scope="col">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.person_id || person.row_index}>
              {fields.map(([key, label]) => {
                const decision = person.result?.profile?.fields?.[key];
                const originalName =
                  person.original_row?.full_name ??
                  person.original_row?.name ??
                  null;
                const fallbackName =
                  key === "full_name" &&
                  ["string", "number", "boolean"].includes(typeof originalName)
                    ? String(originalName)
                    : null;
                const value = decision?.value || fallbackName;
                return (
                  <td key={key}>
                    <button
                      type="button"
                      className={`result-cell ${value ? "" : "missing-cell"}`}
                      aria-label={`Inspect ${label.toLowerCase()} details for row ${person.row_index}`}
                      onClick={() =>
                        onSelect({
                          field: key,
                          request: job,
                          person,
                          row: person.row_index,
                        })
                      }
                    >
                      <span className="field-result-value" title={value || undefined}>
                        {value || "Not found"}
                      </span>
                      <span className="field-meta">
                        {decision
                          ? `${formatPercent(decision.confidence)} confidence`
                          : person.error_code
                            ? titleCase(person.error_code)
                            : titleCase(person.status)}
                        {key === "full_name" && decision && (
                          <span className="person-row-status">
                            {titleCase(person.status)}
                          </span>
                        )}
                        {decision?.review_required && (
                          <span className="review-dot">Review</span>
                        )}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Results({
  job,
  onCancel,
  onExport,
  onResume,
  resumeDisabled,
  onRetryResults,
  onSelect,
  regionRef,
}) {
  useEffect(() => {
    if (!job) return;
    regionRef.current?.focus({ preventScroll: true });
    regionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }, [job?.id, regionRef]);

  const mayBeActive = job && activeStatuses.has(job.status);
  const isActive = mayBeActive && !job.monitoringStopped;
  const terminal = job && terminalStatuses.has(job.status);
  const person = job?.results?.people?.[0];
  const hasResults = Boolean(job?.results);

  return (
    <section
      className="results-panel"
      ref={regionRef}
      tabIndex={-1}
      aria-labelledby="results-title"
    >
      <div className="results-heading">
        <div className="result-context">
          <h2 id="results-title">{job ? requestType(job) : "Results"}</h2>
          {job && (
            <p>
              {job.label}
              {job.organisation && ` · ${job.organisation}`}
            </p>
          )}
        </div>
        <div className="result-actions">
          {job?.jobId && job.monitoringStopped && (
            <button
              type="button"
              className="secondary"
              disabled={job.cancelPending || resumeDisabled}
              onClick={() => onResume(job)}
            >
              <RefreshCw size={16} /> Resume
            </button>
          )}
          {job?.jobId && mayBeActive && (
            <button
              type="button"
              className="secondary"
              disabled={job.cancelPending}
              onClick={() => onCancel(job)}
            >
              {job.cancelPending ? "Cancelling…" : "Cancel"}
            </button>
          )}
          {job?.jobId && terminal && (
            <>
              <button
                type="button"
                className="secondary"
                disabled={Boolean(job.exporting)}
                onClick={() => onExport(job, "csv")}
              >
                <ArrowDownToLine size={16} /> CSV
              </button>
              <button
                type="button"
                className="secondary"
                disabled={Boolean(job.exporting)}
                onClick={() => onExport(job, "xlsx")}
              >
                <ArrowDownToLine size={16} /> XLSX
              </button>
            </>
          )}
        </div>
      </div>

      {!job ? (
        <div className="idle-results">
          <span className="idle-icon"><Search size={27} /></span>
          <h3>No results yet</h3>
          <p>Research a person or select a file to begin.</p>
        </div>
      ) : (
        <>
          <div className="results-status-row" aria-live="polite">
            <StatusBadge
              status={job.monitoringStopped ? "monitoring_stopped" : job.status}
            />
            {job.jobId && <span>Job {job.jobId}</span>}
            {job.totalPeople > 0 && (
              <span>
                {job.totalPeople} {job.totalPeople === 1 ? "person" : "people"}
              </span>
            )}
          </div>
          <JobProgress job={job} />

          {job.pollError && (
            <div className="inline-notice warning" role="status">
              <AlertCircle size={17} />
              <span>{job.pollError} Retrying automatically.</span>
            </div>
          )}
          {job.error && (
            <div className="inline-notice error" role="alert">
              <AlertCircle size={17} />
              <span>{job.error}</span>
              {terminal && job.jobId && !hasResults && (
                <button type="button" className="text-button" onClick={() => onRetryResults(job)}>
                  Retry results
                </button>
              )}
            </div>
          )}
          {job.exportError && (
            <div className="inline-notice error" role="alert">
              <AlertCircle size={17} />
              <span>{job.exportError}</span>
            </div>
          )}

          {isActive && (
            <p className="loading-status results-loading-note" role="status">
              <i />{" "}
              {job.status === "submitting"
                ? "Submitting research request"
                : job.status === "queued"
                  ? "Waiting for research to start"
                  : "Research in progress"}
            </p>
          )}

          {job.kind === "person" ? (
            person?.result ? (
              <>
                <ProfileSummary person={person} />
                <div className="profile-fields" aria-label="Research fields">
                  {fields.map(([key, label]) => (
                    <FieldCard
                      key={key}
                      field={key}
                      label={label}
                      person={person}
                      request={job}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </>
            ) : isActive ? (
              <PersonSkeleton />
            ) : (
              <div className="terminal-empty">
                <AlertCircle size={22} />
                <h3>
                  {job.monitoringStopped
                    ? "Status checks paused"
                    : "No profile was returned"}
                </h3>
                <p>
                  {job.monitoringStopped
                    ? "Resume status checks when the service is available."
                    : person?.error_code
                    ? titleCase(person.error_code)
                    : job.error || `The job ended as ${titleCase(job.status)}.`}
                </p>
              </div>
            )
          ) : (
            <BatchTable job={job} onSelect={onSelect} />
          )}
        </>
      )}
    </section>
  );
}

export default function App() {
  const [nav, setNav] = useState("Research");
  const [name, setName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [file, setFile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [selection, setSelection] = useState(null);
  const resultsRegion = useRef(null);
  const nameInput = useRef(null);
  const fileAction = useRef(null);
  const nextId = useRef(1);

  const activeJob = jobs.find((job) => job.id === activeId) ?? null;
  const busy = jobs.some(
    (job) => activeStatuses.has(job.status) && !job.monitoringStopped,
  );
  const pollingJob =
    jobs.find(
      (job) =>
        job.jobId &&
        activeStatuses.has(job.status) &&
        !job.cancelPending &&
        !job.monitoringStopped,
    ) ?? null;

  function updateJob(id, update) {
    setJobs((items) =>
      items.map((job) =>
        job.id === id
          ? { ...job, ...(typeof update === "function" ? update(job) : update) }
          : job,
      ),
    );
  }

  async function loadResults(job, signal) {
    try {
      const response = await getJobResults(job.jobId, { signal });
      updateJob(job.id, {
        results: response,
        status: response.status || job.status,
        error: null,
        pollError: null,
      });
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "REQUEST_ABORTED") {
        return;
      }
      updateJob(job.id, {
        error: errorMessage(error, "Results could not be loaded."),
      });
    }
  }

  useEffect(() => {
    if (
      !pollingJob?.jobId ||
      terminalStatuses.has(pollingJob.status) ||
      pollingJob.cancelPending
    ) {
      return undefined;
    }

    let stopped = false;
    let timer;
    let controller;
    let consecutiveFailures = 0;

    async function poll() {
      controller = new AbortController();
      try {
        const view = await getJob(pollingJob.jobId, {
          signal: controller.signal,
        });
        if (stopped) return;
        consecutiveFailures = 0;
        updateJob(pollingJob.id, {
          status: view.status,
          totalPeople: view.total_people,
          counts: view.counts,
          jobView: view,
          pollError: null,
          monitoringStopped: false,
        });
        if (terminalStatuses.has(view.status)) {
          await loadResults({ ...pollingJob, status: view.status });
          return;
        }
        timer = window.setTimeout(poll, 2500);
      } catch (error) {
        if (stopped || error?.name === "AbortError") return;
        consecutiveFailures += 1;
        const message = errorMessage(
          error,
          "The job status could not be checked.",
        );
        const nonRetryable = [400, 401, 403, 404, 409, 422].includes(
          error?.status,
        );
        if (nonRetryable || consecutiveFailures >= 5) {
          updateJob(pollingJob.id, {
            monitoringStopped: true,
            pollError: null,
            error: `Status checks paused. ${message}`,
          });
          return;
        }
        updateJob(pollingJob.id, { pollError: message });
        timer = window.setTimeout(poll, 4000);
      }
    }

    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [pollingJob?.id, pollingJob?.jobId, pollingJob?.cancelPending]);

  async function beginResearch(kind) {
    const trimmedName = name.trim();
    if (
      busy ||
      (kind === "person" && trimmedName.length < 2) ||
      (kind === "file" && !file)
    ) {
      return;
    }

    const id = nextId.current++;
    const job = {
      id,
      kind,
      label: kind === "person" ? trimmedName : file.name,
      organisation: kind === "person" ? organisation.trim() : "",
      createdAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "submitting",
      totalPeople: kind === "person" ? 1 : 0,
      counts: null,
      results: null,
      error: null,
      monitoringStopped: false,
    };
    setJobs((items) => [job, ...items]);
    setActiveId(id);
    setSelection(null);
    setNav("Research");

    try {
      const response =
        kind === "person"
          ? await researchPerson({
              full_name: trimmedName,
              ...(organisation.trim()
                ? { organisation: organisation.trim() }
                : {}),
            })
          : await researchBatch(file);
      updateJob(id, {
        jobId: response.job_id,
        status: response.status,
        totalPeople: response.total_people,
      });
    } catch (error) {
      updateJob(id, {
        status: "failed",
        error: errorMessage(error, "The research request could not be started."),
      });
    }
  }

  async function handleCancel(job) {
    if (!job.jobId || job.cancelPending) return;
    updateJob(job.id, { cancelPending: true, error: null, pollError: null });
    try {
      const view = await cancelJob(job.jobId);
      updateJob(job.id, {
        status: view.status || "cancelled",
        counts: view.counts || job.counts,
        jobView: view,
        cancelPending: false,
        monitoringStopped: false,
      });
      if (terminalStatuses.has(view.status || "cancelled")) {
        await loadResults({ ...job, status: view.status || "cancelled" });
      }
    } catch (error) {
      if (error?.status === 409) {
        try {
          const view = await getJob(job.jobId);
          updateJob(job.id, {
            status: view.status,
            counts: view.counts,
            jobView: view,
            cancelPending: false,
            monitoringStopped: terminalStatuses.has(view.status)
              ? false
              : job.monitoringStopped,
          });
          if (terminalStatuses.has(view.status)) {
            await loadResults({ ...job, status: view.status });
          }
          return;
        } catch (refreshError) {
          updateJob(job.id, {
            cancelPending: false,
            error: errorMessage(
              refreshError,
              "The latest job status could not be loaded.",
            ),
          });
          return;
        }
      }
      updateJob(job.id, {
        cancelPending: false,
        error: errorMessage(error, "The job could not be cancelled."),
      });
    }
  }

  function resumeMonitoring(job) {
    if (
      busy ||
      !job.jobId ||
      !activeStatuses.has(job.status) ||
      !job.monitoringStopped
    ) {
      return;
    }
    updateJob(job.id, {
      monitoringStopped: false,
      error: null,
      pollError: null,
    });
  }

  async function handleExport(job, format) {
    updateJob(job.id, { exporting: format, exportError: null });
    try {
      await downloadExport(job.jobId, format);
      updateJob(job.id, { exporting: null });
    } catch (error) {
      updateJob(job.id, {
        exporting: null,
        exportError: errorMessage(error, `The ${format.toUpperCase()} export failed.`),
      });
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="header-inner">
          <a
            className="brand"
            href="#research"
            aria-label={`${brand.name} research`}
            onClick={(event) => {
              event.preventDefault();
              setNav("Research");
            }}
          >
            <span className="logo-crop">
              <img
                src={`${import.meta.env.BASE_URL}KB_dark-text.svg`}
                alt={brand.name}
              />
            </span>
          </a>
          <span className="header-divider" />
          <nav aria-label="Main navigation">
            {["Research", "History"].map((item) => (
              <button
                type="button"
                key={item}
                aria-current={nav === item ? "page" : undefined}
                className={nav === item ? "nav-active" : ""}
                onClick={() => setNav(item)}
              >
                {item === "Research" ? (
                  <Search size={17} />
                ) : (
                  <Clock3 size={17} />
                )}
                {item}
              </button>
            ))}
          </nav>
          <div className="header-right">
            <span className="workspace-label">
              <ShieldCheck size={15} /> Internal workspace
            </span>
          </div>
        </div>
      </header>

      <main>
        <div className="page-heading">
          <div>
            <h1>{nav}</h1>
            <p>
              {nav === "Research"
                ? "Research a person or enrich a file."
                : "Review research from this session."}
            </p>
          </div>
          {busy && (
            <span className="workspace-status">
              <Clock3 size={15} /> Research in progress
            </span>
          )}
        </div>

        {nav === "Research" ? (
          <>
            <div className="workflow-grid">
              <section
                className="workflow-card person-card"
                aria-labelledby="person-title"
              >
                <div className="card-heading">
                  <span className="feature-icon"><UserRound size={23} /></span>
                  <h2 id="person-title">Research a person</h2>
                </div>
                <p className="workflow-description">
                  Search by name and review available information.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    beginResearch("person");
                  }}
                >
                  <div className="search-form">
                    <div className="person-input">
                      <Search size={19} />
                      <label className="sr-only" htmlFor="person-name">
                        Full name
                      </label>
                      <input
                        ref={nameInput}
                        id="person-name"
                        placeholder="Search by full name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        disabled={busy}
                        required
                        minLength={2}
                        maxLength={200}
                      />
                    </div>
                    <button
                      className="primary"
                      disabled={busy || name.trim().length < 2}
                      type="submit"
                    >
                      Research <ArrowRight size={16} />
                    </button>
                  </div>
                  <div className="context-input">
                    <label htmlFor="organisation">
                      Organisation <span>(optional)</span>
                    </label>
                    <input
                      id="organisation"
                      placeholder="Organisation name"
                      value={organisation}
                      maxLength={200}
                      disabled={busy}
                      onChange={(event) => setOrganisation(event.target.value)}
                    />
                  </div>
                </form>
              </section>

              <Upload
                actionRef={fileAction}
                file={file}
                onFile={setFile}
                onRemove={() => setFile(null)}
                onStart={() => beginResearch("file")}
                busy={busy}
              />
            </div>

            <Results
              job={activeJob}
              onCancel={handleCancel}
              onExport={handleExport}
              onResume={resumeMonitoring}
              resumeDisabled={busy}
              onRetryResults={(job) => loadResults(job)}
              onSelect={setSelection}
              regionRef={resultsRegion}
            />
          </>
        ) : (
          <section className="history-panel" aria-labelledby="history-title">
            <div className="history-heading">
              <h2 id="history-title">Research history</h2>
              {jobs.length > 0 && <span>This session</span>}
            </div>
            {jobs.length === 0 ? (
              <div className="empty-state">
                <Clock3 size={30} />
                <h3>No research history</h3>
                <p>
                  Your person research and file enrichment requests will appear
                  here.
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setNav("Research")}
                >
                  Go to Research <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              jobs.map((job) => (
                <button
                  type="button"
                  className="history-row"
                  key={job.id}
                  onClick={() => {
                    setActiveId(job.id);
                    setSelection(null);
                    setNav("Research");
                  }}
                >
                  <span className="history-kind">
                    {job.kind === "person" ? (
                      <UserRound size={21} />
                    ) : (
                      <FileSpreadsheet size={21} />
                    )}
                  </span>
                  <span className="history-details">
                    <strong>{job.label}</strong>
                    <span>
                      {requestType(job)} · {job.createdAt}
                    </span>
                  </span>
                  <StatusBadge
                    status={
                      job.monitoringStopped ? "monitoring_stopped" : job.status
                    }
                  />
                  <ChevronRight size={17} />
                </button>
              ))
            )}
          </section>
        )}
      </main>

      {selection && (
        <EvidenceDrawer
          key={`${selection.person?.person_id}-${selection.field}`}
          selection={selection}
          onClose={() => setSelection(null)}
        />
      )}
    </>
  );
}
