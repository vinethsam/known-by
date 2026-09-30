import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  deleteLibraryFile,
  downloadLibraryFile,
  formatApiError,
  listLibraryFiles,
} from "./api.js";
import { getSavedBy } from "./presentation.js";
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

function libraryError(error, fallback) {
  const message = formatApiError(error);
  return message && message !== "Something went wrong while contacting the research service."
    ? message
    : fallback;
}

export default function SharedLibrary() {
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

  const includesSavedBy = useMemo(
    () => files.some((file) => Boolean(getSavedBy(file))),
    [files],
  );

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
        setFiles(items);
        setHasMore(items.length === PAGE_SIZE);
        setActionError("");
      })
      .catch((error) => {
        if (error?.name === "AbortError" || error?.code === "REQUEST_ABORTED") return;
        setLoadError(libraryError(error, "Unable to load Shared Library."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadToken]);

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
        libraryError(error, "Unable to load more saved files."),
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
        libraryError(error, `Unable to download ${file.filename}.`),
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
      setAnnouncement(`Deleted ${file.filename} from Shared Library.`);
    } catch (error) {
      setActionError(
        libraryError(error, `Unable to delete ${file.filename}.`),
      );
    } finally {
      setDeleting("");
    }
  }

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
                <th scope="col">Saved date</th>
                {includesSavedBy && <th scope="col">Saved by</th>}
                <th scope="col">File type</th>
                <th scope="col">File size</th>
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
                    <td data-label="File name">
                      <span className="shared-library__file-name">
                        <FileSpreadsheet size={19} />
                        <strong title={file.filename}>{file.filename}</strong>
                      </span>
                    </td>
                    <td data-label="Saved date">
                      {file.saved_at ? (
                        <time dateTime={file.saved_at}>
                          {displayDate(file.saved_at)}
                        </time>
                      ) : (
                        "—"
                      )}
                    </td>
                    {includesSavedBy && (
                      <td data-label="Saved by">{getSavedBy(file) || "—"}</td>
                    )}
                    <td data-label="File type">
                      <span className="shared-library__format">
                        {String(file.format || "").toUpperCase() || "—"}
                      </span>
                    </td>
                    <td data-label="File size">{displaySize(file.size_bytes)}</td>
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
