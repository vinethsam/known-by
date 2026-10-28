import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  Eye,
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

export default function SharedLibrary({ onDelete, refreshToken = 0, renderRecords }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloading, setDownloading] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState("");
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

  async function handleDownload(file) {
    if (downloading) return;
    setDownloading(file.file_id);
    setActionError("");
    setAnnouncement("");
    try {
      const result = await downloadLibraryFile(file);
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
    if (deleting) return;
    setDeleting(file.file_id);
    setActionError("");
    setAnnouncement("");
    try {
      await deleteLibraryFile(file.file_id);
      setFiles((items) =>
        items.filter((item) => item.file_id !== file.file_id),
      );
      setDeleteCandidate("");
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
      <div className="library-preview__toolbar">
        {deleteCandidate === selectedFile.file_id ? <div className="shared-library__delete-confirmation" role="group" aria-label={`Delete ${selectedFile.filename}`}>
          <span>Delete this saved result?</span>
          <button className="secondary" disabled={Boolean(deleting)} onClick={() => setDeleteCandidate("")}>Cancel</button>
          <button className="secondary shared-library__danger-button" disabled={Boolean(deleting)} onClick={() => handleDelete(selectedFile)}>{deleting ? "Deleting…" : "Delete"}</button>
        </div> : <button className="secondary" onClick={() => setDeleteCandidate(selectedFile.file_id)}><Trash2 size={15} /> Delete saved file</button>}
      </div>
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
                const isDownloading = downloading === file.file_id;
                const isConfirming = deleteCandidate === file.file_id;
                const isDeleting = deleting === file.file_id;
                return (
                  <tr key={file.file_id}>
                    <td className="shared-library__file-cell" data-label="File name">
                      <span className="shared-library__file-name">
                        <FileSpreadsheet size={19} />
                        <span className="shared-library__file-details">
                          <button type="button" className="text-button shared-library__open-file" onClick={() => openFile(file)} title={file.filename}>{file.filename}</button>
                          <span className="shared-library__file-metadata">
                            <span>{String(file.format || "").toUpperCase() || "—"}</span>
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
                      {isConfirming ? (
                        <div
                          className="shared-library__delete-confirmation"
                          role="group"
                          aria-label={`Delete ${file.filename}`}
                        >
                          <span>Delete this saved result?</span>
                          <button
                            type="button"
                            className="secondary shared-library__compact-button"
                            autoFocus
                            disabled={isDeleting}
                            onClick={() => setDeleteCandidate("")}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="secondary shared-library__compact-button shared-library__danger-button"
                            disabled={isDeleting}
                            onClick={() => handleDelete(file)}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      ) : (
                        <div className="shared-library__actions">
                          <button type="button" className="secondary shared-library__compact-button" onClick={() => openFile(file)}><Eye size={15} /> View records</button>
                          <button
                            type="button"
                            className="secondary shared-library__compact-button"
                            disabled={Boolean(downloading) || Boolean(deleting)}
                            onClick={() => handleDownload(file)}
                          >
                            {isDownloading ? (
                              <RefreshCw className="spin" size={15} />
                            ) : (
                              <ArrowDownToLine size={15} />
                            )}
                            {isDownloading ? "Downloading…" : "Download"}
                          </button>
                          <button
                            type="button"
                            className="secondary shared-library__compact-button"
                            disabled={Boolean(downloading) || Boolean(deleting)}
                            onClick={() => setDeleteCandidate(file.file_id)}
                          >
                            <Trash2 size={15} /> Delete
                          </button>
                        </div>
                      )}
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
    </section>
  );
}
