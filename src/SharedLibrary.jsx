import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  Info,
  MoreVertical,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  deleteLibraryFile,
  downloadLibraryFile,
  listLibraryFiles,
  getLibraryRecords,
} from "./api.js";
import { libraryRecordsJob } from "./library-records.js";
import { formatLibraryError, formatLibrarySavedDate, getSavedBy } from "./presentation.js";
import DatabaseStackIcon from "./DatabaseStackIcon.jsx";
import "./shared-library.css";

const PAGE_SIZE = 50;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function displaySize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function savedFormats(file) {
  return file.available_formats?.length ? file.available_formats : [file.format];
}

function FileActions({ file, busy, onView, onDownload, onDelete }) {
  const [open, setOpen] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef(null);
  const menu = useRef(null);
  const menuId = `file-actions-${file.file_id}`;

  useLayoutEffect(() => {
    if (!open || !menu.current) return undefined;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)),
      top: anchor.bottom + bounds.height + 8 <= window.innerHeight
        ? anchor.bottom + 6 : Math.max(8, anchor.top - bounds.height - 6),
    });
    menu.current.querySelector('button:not(:disabled)')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open && !tooltip) return undefined;
    const close = () => { setOpen(false); setTooltip(null); };
    const outside = (event) => {
      if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, tooltip]);

  function showTooltip(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({ left: Math.max(8, Math.min(rect.left + rect.width / 2 - 51, window.innerWidth - 110)),
      top: rect.top > 42 ? rect.top - 36 : rect.bottom + 7 });
  }

  function menuKeyDown(event) {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = [...menu.current.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % items.length, ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0, End: items.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
  }

  return <div className="shared-library__actions">
    <button type="button" className="icon-button shared-library__action-icon" aria-label={`View Records for ${file.filename}`}
      onMouseEnter={showTooltip} onMouseLeave={() => setTooltip(null)} onFocus={showTooltip} onBlur={() => setTooltip(null)}
      onClick={() => { setTooltip(null); onView(file); }}><Info size={18} /></button>
    <button ref={trigger} type="button" className="icon-button shared-library__action-icon" aria-label={`Actions for ${file.filename}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={busy}
      onClick={() => { setTooltip(null); setOpen((value) => !value); }}><MoreVertical size={18} /></button>
    {tooltip && createPortal(<span role="tooltip" className="library-action-tooltip" style={tooltip}>View Records</span>, document.body)}
    {open && createPortal(<div ref={menu} id={menuId} role="menu" aria-label={`Actions for ${file.filename}`}
      className="library-action-menu" style={position} onKeyDown={menuKeyDown}>
      {["csv", "xlsx"].map((format) => <button key={format} type="button" role="menuitem"
        disabled={!savedFormats(file).includes(format)} title={!savedFormats(file).includes(format) ? "Not stored in this older entry" : undefined}
        onClick={() => { setOpen(false); trigger.current?.focus(); onDownload(file, format); }}>
        <ArrowDownToLine size={16} /> Download {format.toUpperCase()}
      </button>)}
      {file.can_delete === true && <button type="button" role="menuitem" className="library-action-menu__delete"
        onClick={() => { setOpen(false); trigger.current?.focus(); onDelete(file); }}><Trash2 size={16} /> Delete</button>}
    </div>, document.body)}
  </div>;
}

function DeleteConfirmation({ file, deleting, error, onClose, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); trigger?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="library-delete-dialog" aria-labelledby="library-delete-title"
    onCancel={(event) => { event.preventDefault(); if (!deleting) onClose(); }}>
    <h3 id="library-delete-title">Delete saved result?</h3>
    <p>This will delete <strong>{file.filename}</strong> and its saved formats from the shared Database.</p>
    {error && <p className="library-delete-dialog__error" role="alert">{error}</p>}
    <div><button type="button" className="secondary" autoFocus disabled={deleting} onClick={onClose}>Cancel</button>
      <button type="button" className="secondary shared-library__danger-button" disabled={deleting} onClick={() => onConfirm(file)}>{deleting ? "Deleting…" : "Delete"}</button></div>
  </dialog>, document.body);
}

export default function SharedLibrary({ onDelete, refreshToken = 0, renderRecords }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const loadMoreController = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [recordPage, setRecordPage] = useState(null);
  const [recordOffset, setRecordOffset] = useState(0);
  const [recordQuery, setRecordQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);

  useEffect(() => {
    if (!selectedFile) return undefined;
    const controller = new AbortController();
    setRecordsLoading(true);
    setRecordsError("");
    getLibraryRecords(selectedFile.file_id, { limit: PAGE_SIZE, offset: recordOffset, q: recordQuery, signal: controller.signal })
      .then((page) => { if (!controller.signal.aborted) setRecordPage(page); })
      .catch((error) => {
        if (!controller.signal.aborted) setRecordsError(formatLibraryError(error, "This saved file could not be previewed. You can still try downloading the original file."));
      })
      .finally(() => { if (!controller.signal.aborted) setRecordsLoading(false); });
    return () => controller.abort();
  }, [selectedFile?.file_id, recordOffset, recordQuery, previewRetry]);

  function openFile(file) {
    setRecordPage(null);
    setRecordOffset(0);
    setRecordQuery("");
    setSearchInput("");
    setRecordsError("");
    setRecordsLoading(true);
    setSelectedFile(file);
  }

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadMoreController.current?.abort();
    setLoading(true);
    setLoadingMore(false);
    setFiles([]);
    setHasMore(false);
    setLoadError("");

    listLibraryFiles({ limit: PAGE_SIZE, offset: 0, signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        setFiles(items);
        setHasMore(items.length === PAGE_SIZE);
        setActionError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError" || error?.code === "REQUEST_ABORTED") return;
        setLoadError(formatLibraryError(error, "Unable to load Shared Library."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadToken, refreshToken]);

  useEffect(
    () => () => {
      loadMoreController.current?.abort();
    },
    [],
  );

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setLoadingMore(true);
    setActionError("");
    setAnnouncement("");
    try {
      const items = await listLibraryFiles({
        limit: PAGE_SIZE,
        offset: files.length,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setFiles((current) => {
        const existing = new Set(current.map((file) => file.file_id));
        return [
          ...current,
          ...items.filter((file) => !existing.has(file.file_id)),
        ];
      });
      setHasMore(items.length === PAGE_SIZE);
      setAnnouncement(
        items.length
          ? `Loaded ${items.length} more saved ${items.length === 1 ? "file" : "files"}.`
          : "All saved files are loaded.",
      );
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "REQUEST_ABORTED") return;
      setActionError(
        formatLibraryError(error, "Unable to load more saved files."),
      );
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setLoadingMore(false);
      }
    }
  }

  async function handleDownload(file, format = file.format) {
    if (downloading) return;
    setDownloading(file.file_id);
    setActionError("");
    setAnnouncement("");
    try {
      const result = await downloadLibraryFile(file, { format });
      setAnnouncement(`Downloaded ${result?.filename || file.filename}.`);
    } catch (error) {
      setActionError(
        formatLibraryError(error, `Unable to download ${file.filename}.`),
      );
    } finally {
      setDownloading("");
    }
  }

  async function handleDelete(file) {
    if (deleting || file.can_delete !== true) return;
    setDeleting(file.file_id);
    setActionError("");
    setAnnouncement("");
    try {
      await deleteLibraryFile(file.file_id);
      setFiles((items) =>
        items.filter((item) => item.file_id !== file.file_id),
      );
      setDeleteCandidate(null);
      if (selectedFile?.file_id === file.file_id) setSelectedFile(null);
      setAnnouncement(`Deleted ${file.filename} from Shared Library.`);
      onDelete?.(file.file_id);
    } catch (error) {
      setActionError(
        formatLibraryError(error, `Unable to delete ${file.filename}.`),
      );
    } finally {
      setDeleting("");
    }
  }

  if (selectedFile) return (
    <section className="history-panel shared-library library-preview" aria-labelledby="library-preview-title" aria-busy={recordsLoading}>
      <div className="library-preview__toolbar">
        <button type="button" className="secondary" onClick={() => setSelectedFile(null)}><ArrowLeft size={15} /> Back to files</button>
        <button type="button" className="secondary" disabled={Boolean(downloading)} onClick={() => handleDownload(selectedFile)}><ArrowDownToLine size={15} /> {downloading ? "Downloading…" : "Download original"}</button>
      </div>
      <div className="history-heading shared-library__heading">
        <div><h2 id="library-preview-title">{selectedFile.filename}</h2><p>Saved records · {getSavedBy(selectedFile) || "Unknown saver"} · {formatLibrarySavedDate(selectedFile.saved_at)}</p></div>
      </div>
      <form className="library-preview__search" onSubmit={(event) => { event.preventDefault(); setRecordOffset(0); setRecordQuery(searchInput.trim()); }}>
        <label htmlFor="saved-record-search">Search saved records</label>
        <input id="saved-record-search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Name, organisation, university…" maxLength={200} />
        <button className="secondary" type="submit">Search</button>
      </form>
      {actionError && <div className="inline-notice error shared-library__notice" role="alert">{actionError}</div>}
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {recordsLoading ? <div className="shared-library__state" role="status"><RefreshCw className="spin" size={22} /><p>Loading saved records…</p></div>
        : recordsError ? <div className="shared-library__state" role="alert"><p>{recordsError}</p><button className="secondary" onClick={() => setPreviewRetry((value) => value + 1)}>Try again</button></div>
        : recordPage?.records.length ? <>
          {renderRecords?.(libraryRecordsJob(recordPage))}
          <nav className="library-preview__pagination" aria-label="Saved record pages">
            <button className="secondary" disabled={recordOffset === 0} onClick={() => setRecordOffset(Math.max(0, recordOffset - PAGE_SIZE))}>Previous</button>
            <span>{recordOffset + 1}–{recordOffset + recordPage.records.length} of {recordPage.total} records</span>
            <button className="secondary" disabled={!recordPage.has_more} onClick={() => setRecordOffset(recordOffset + PAGE_SIZE)}>Next</button>
          </nav>
        </> : <div className="shared-library__state"><h3>{recordQuery ? "No matching records" : "No saved records"}</h3><p>{recordQuery ? "Try another search." : "This file does not contain research rows."}</p></div>}
    </section>
  );

  return (
    <section
      className="history-panel shared-library"
      aria-labelledby="shared-library-title"
      aria-busy={loading}
    >
      <div className="history-heading shared-library__heading">
        <div>
          <h2 id="shared-library-title">Shared Library</h2>
          <p>Saved research exports for the KnownBy team.</p>
        </div>
        {!loading && !loadError && files.length > 0 && (
          <span>
            {files.length}{hasMore ? "+" : ""} saved {files.length === 1 ? "file" : "files"}
          </span>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {actionError && (
        <div className="inline-notice error shared-library__notice" role="alert">
          <AlertCircle size={17} />
          <span>{actionError}</span>
        </div>
      )}

      {loading ? (
        <div className="shared-library__state" role="status">
          <RefreshCw className="spin" size={25} />
          <h3>Loading Shared Library</h3>
          <p>Retrieving saved research files…</p>
        </div>
      ) : loadError ? (
        <div className="shared-library__state" role="alert">
          <AlertCircle size={28} />
          <h3>Unable to load Shared Library</h3>
          <p>{loadError}</p>
          <button type="button" className="secondary" onClick={reload}>
            <RefreshCw size={16} /> Try again
          </button>
        </div>
      ) : files.length === 0 ? (
        <div className="shared-library__state">
          <DatabaseStackIcon size={32} />
          <h3>No saved research yet</h3>
          <p>Completed research can be saved here from the Research page.</p>
        </div>
      ) : (
        <div
          className="shared-library__table-wrap"
          role="region"
          aria-label="Saved research files"
          tabIndex={0}
        >
          <table className="shared-library__table">
            <caption className="sr-only">
              Files saved to the Shared Library
            </caption>
            <thead>
              <tr>
                <th scope="col">File name</th>
                <th scope="col">Saved by</th>
                <th scope="col">Date saved</th>
                <th scope="col" className="shared-library__actions-heading">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                return (
                  <tr key={file.file_id}>
                    <td className="shared-library__file-cell" data-label="File name">
                      <span className="shared-library__file-name">
                        <FileSpreadsheet size={19} />
                        <span className="shared-library__file-details">
                          <strong title={file.filename}>{file.filename}</strong>
                          <span className="shared-library__file-metadata">
                            <span>{savedFormats(file).map((format) => format.toUpperCase()).join(" + ")}</span>
                            <span aria-hidden="true">·</span>
                            <span>{displaySize(file.size_bytes)}</span>
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="shared-library__saved-by" data-label="Saved by">
                      <span className="shared-library__mobile-label">Saved by </span>
                      {getSavedBy(file) || "Unknown"}
                    </td>
                    <td className="shared-library__saved-date" data-label="Date saved">
                      {file.saved_at ? (
                        <time dateTime={file.saved_at} title={displayDate(file.saved_at)}>
                          {formatLibrarySavedDate(file.saved_at)}
                        </time>
                      ) : (
                        "Date unavailable"
                      )}
                    </td>
                    <td data-label="Actions" className="shared-library__actions-cell">
                      <FileActions file={file} busy={Boolean(downloading) || Boolean(deleting)} onView={openFile} onDownload={handleDownload}
                        onDelete={(candidate) => { setActionError(""); setDeleteCandidate(candidate); }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore && (
            <div className="shared-library__load-more">
              <button
                type="button"
                className="secondary"
                disabled={loadingMore}
                onClick={handleLoadMore}
              >
                {loadingMore && <RefreshCw className="spin" size={15} />}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
      {deleteCandidate && <DeleteConfirmation file={deleteCandidate} deleting={Boolean(deleting)} error={actionError}
        onClose={() => setDeleteCandidate(null)} onConfirm={handleDelete} />}
    </section>
  );
}
