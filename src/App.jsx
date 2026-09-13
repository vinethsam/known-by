import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  FileUp,
  Layers3,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { fields } from "./data.js";

const brand = { name: "KnownBy", logo: "/KB_dark-text.svg" };
const requestType = (request) =>
  request.kind === "person" ? "Person research" : "File enrichment";

function Skeleton({ className = "" }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />;
}

function EvidenceDrawer({ selection, onClose }) {
  const dialog = useRef(null);
  const fieldLabel = fields.find(([key]) => key === selection.field)[1];
  useEffect(() => {
    const panel = dialog.current;
    const trigger = document.activeElement;
    panel.showModal();
    return () => {
      panel.close();
      trigger?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="source-dialog"
      aria-labelledby="evidence-title"
      onCancel={onClose}
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
            className="icon-button"
            aria-label="Close field details"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="field-drawer-heading">
          <h2 id="evidence-title">{fieldLabel}</h2>
          <p>
            {selection.request.label}
            {selection.row !== undefined && ` · Row ${selection.row + 1}`}
          </p>
        </div>
        <p className="loading-status" role="status">
          <i /> Awaiting field information
        </p>
        <div
          className="evidence-loading"
          aria-busy="true"
          aria-label={`${fieldLabel} information pending`}
        >
          <div className="evidence-placeholder">
            <h3>Value</h3>
            <Skeleton className="skeleton-value" />
          </div>
          <div className="evidence-row">
            <div className="confidence-placeholder">
              <h3>Confidence</h3>
              <Skeleton className="skeleton-confidence" />
            </div>
            <div className="confidence-placeholder">
              <h3>Review status</h3>
              <Skeleton className="skeleton-short" />
            </div>
          </div>
          <div className="evidence-heading">
            <h3>Sources & evidence</h3>
            <Layers3 size={17} />
          </div>
          <div className="evidence-placeholder">
            <Skeleton className="skeleton-short" />
            <Skeleton className="skeleton-line" />
            <Skeleton className="skeleton-line" />
          </div>
        </div>
      </div>
    </dialog>
  );
}

function Upload({ file, onFile, onRemove, onStart, busy, actionRef }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function accept(files) {
    setDragging(false);
    if (busy) return;
    const picked = files?.[0];
    if (!picked) return;
    if (files.length > 1) {
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
    <section
      className="workflow-card upload-card"
      aria-labelledby="upload-title"
    >
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
            if (!event.currentTarget.contains(event.relatedTarget))
              setDragging(false);
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
                className="text-button"
                onClick={() => input.current.click()}
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
              className="secondary"
              onClick={() => input.current.click()}
              disabled={busy}
            >
              Replace file
            </button>
          )}
        </div>
        <button
          ref={actionRef}
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

function Results({ request, onCancel, onSelect, regionRef }) {
  useEffect(() => {
    if (!request) return;
    // Move keyboard focus after user initiation, respecting reduced-motion preferences.
    regionRef.current?.focus({ preventScroll: true });
    regionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  }, [request?.id, regionRef]);

  return (
    <section
      className="results-panel"
      ref={regionRef}
      tabIndex={-1}
      aria-labelledby="results-title"
    >
      <div className="results-heading">
        <div className="result-context">
          <h2 id="results-title">
            {request ? requestType(request) : "Results"}
          </h2>
          {request && (
            <p>
              {request.label}
              {request.organisation && ` · ${request.organisation}`}
            </p>
          )}
        </div>
        <div className="result-actions">
          {request && (
            <button className="secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="secondary" disabled>
            <ArrowDownToLine size={16} /> Export
          </button>
        </div>
      </div>
      {!request ? (
        <div className="idle-results">
          <span className="idle-icon">
            <Search size={27} />
          </span>
          <h3>No results yet</h3>
          <p>Research a person or select a file to begin.</p>
        </div>
      ) : (
        <>
          <p className="loading-status results-loading-note" role="status">
            <i /> Awaiting results
          </p>
          {request.kind === "person" ? (
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
              <div className="profile-fields" aria-label="Research fields">
                {fields.map(([key, label]) => (
                  <button
                    key={key}
                    className="result-field"
                    aria-label={`Inspect ${label.toLowerCase()} details`}
                    onClick={() => onSelect({ field: key, request })}
                  >
                    <span className="field-title">
                      <span className="field-label-text">{label}</span>
                      <Layers3 className="field-evidence-icon" size={16} />
                    </span>
                    <span className="field-placeholder" aria-busy="true">
                      <Skeleton className="skeleton-value" />
                      <span className="sr-only">Value pending</span>
                    </span>
                    <span className="field-meta">
                      <span>Confidence</span>
                      <Skeleton className="skeleton-confidence" />
                      <span>Sources</span>
                      <Skeleton className="skeleton-source" />
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="File research fields; scroll horizontally for all columns"
            >
              <table className="file-results">
                <thead>
                  <tr>
                    {fields.map(([key, label]) => (
                      <th key={key} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }, (_, row) => (
                    <tr key={row}>
                      {fields.map(([key, label]) => (
                        <td key={key}>
                          <button
                            className="skeleton-cell"
                            aria-label={`Inspect ${label.toLowerCase()} details for row ${row + 1}`}
                            onClick={() =>
                              onSelect({ field: key, request, row })
                            }
                          >
                            <span
                              className="field-placeholder"
                              aria-busy="true"
                            >
                              <Skeleton className="skeleton-value" />
                              <span className="sr-only">Value pending</span>
                            </span>
                            <span className="field-meta">
                              <Skeleton className="skeleton-confidence" />
                              <Layers3
                                className="field-evidence-icon"
                                size={14}
                              />
                            </span>
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
  const [requests, setRequests] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [selection, setSelection] = useState(null);
  const results = useRef(null);
  const nameInput = useRef(null);
  const fileAction = useRef(null);
  const cancelFocus = useRef(null);
  const nextId = useRef(1);
  const activeRequest = requests.find(
    (request) => request.id === activeId && request.status === "pending",
  );
  const busy = Boolean(activeRequest);
  useEffect(() => {
    if (!busy && cancelFocus.current) {
      cancelFocus.current.focus();
      cancelFocus.current = null;
    }
  }, [busy]);

  function beginResearch(kind) {
    if (
      busy ||
      (kind === "person" && !name.trim()) ||
      (kind === "file" && !file)
    )
      return;
    // Retain only user-entered request metadata. No research, file reading, or requests occur here.
    const request = {
      id: nextId.current++,
      kind,
      label: kind === "person" ? name.trim() : file.name,
      organisation: kind === "person" ? organisation.trim() : "",
      createdAt: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "pending",
    };
    setRequests((items) => [request, ...items]);
    setActiveId(request.id);
    setSelection(null);
    setNav("Research");
  }

  function cancelResearch() {
    cancelFocus.current =
      activeRequest.kind === "person" ? nameInput.current : fileAction.current;
    setRequests((items) =>
      items.map((request) =>
        request.id === activeId ? { ...request, status: "cancelled" } : request,
      ),
    );
    setActiveId(null);
    setSelection(null);
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
              <img src={brand.logo} alt={brand.name} />
            </span>
          </a>
          <span className="header-divider" />
          <nav aria-label="Main navigation">
            {["Research", "History"].map((item) => (
              <button
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
                : "Review previous research."}
            </p>
          </div>
          {busy && (
            <span className="workspace-status">
              <Clock3 size={15} /> 1 pending request
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
                  <span className="feature-icon">
                    <UserRound size={23} />
                  </span>
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
                        maxLength={120}
                      />
                    </div>
                    <button
                      className="primary"
                      disabled={busy || !name.trim()}
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
                      maxLength={160}
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
              request={activeRequest}
              onCancel={cancelResearch}
              onSelect={setSelection}
              regionRef={results}
            />
          </>
        ) : (
          <section className="history-panel" aria-labelledby="history-title">
            <div className="history-heading">
              <h2 id="history-title">Research history</h2>
              {requests.length > 0 && <span>This session</span>}
            </div>
            {requests.length === 0 ? (
              <div className="empty-state">
                <Clock3 size={30} />
                <h3>No research history</h3>
                <p>
                  Your person research and file enrichment requests will appear
                  here.
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    setNav("Research");
                  }}
                >
                  Go to Research <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              requests.map((request) => (
                <button
                  className="history-row"
                  key={request.id}
                  disabled={request.status === "cancelled"}
                  onClick={() => {
                    setActiveId(request.id);
                    setNav("Research");
                  }}
                >
                  <span className="history-kind">
                    {request.kind === "person" ? (
                      <UserRound size={21} />
                    ) : (
                      <FileSpreadsheet size={21} />
                    )}
                  </span>
                  <span className="history-details">
                    <strong>{request.label}</strong>
                    <span>
                      {requestType(request)} · {request.createdAt}
                    </span>
                  </span>
                  <span className="history-status">
                    {request.status === "pending" ? "Pending" : "Cancelled"}
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))
            )}
          </section>
        )}
      </main>
      {selection && (
        <EvidenceDrawer
          key={`${selection.field}-${selection.row ?? "person"}`}
          selection={selection}
          onClose={() => setSelection(null)}
        />
      )}
    </>
  );
}
