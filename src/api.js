const API_ROOT = "/api/v1";
const JOB_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
const PERSON_STATUSES = new Set([
  "queued",
  "researching",
  "completed",
  "failed",
  "review_required",
  "cancelled",
]);
const JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.statusText = options.statusText ?? "";
    this.code = options.code ?? "API_ERROR";
    this.details = options.details ?? null;
  }
}

function pathForJob(jobId, suffix = "") {
  const value = String(jobId ?? "").trim();
  if (!value) {
    throw new ApiError("A job ID is required.", { code: "INVALID_JOB_ID" });
  }
  return `${API_ROOT}/jobs/${encodeURIComponent(value)}${suffix}`;
}

function readableLocation(location) {
  if (!Array.isArray(location)) return "";
  return location
    .filter((part) => part !== "body")
    .map((part) => String(part).replaceAll("_", " "))
    .join(" › ");
}

function messageFromPayload(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;

  const detail = payload.detail ?? payload.message ?? payload.error;
  if (typeof detail === "string" && detail.trim()) return detail.trim();

  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return "";
        const message = String(entry.msg ?? entry.message ?? "").trim();
        const location = readableLocation(entry.loc);
        return message ? (location ? `${location}: ${message}` : message) : "";
      })
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }

  if (detail && typeof detail === "object") {
    const code = typeof detail.code === "string" ? detail.code : "";
    const settings = Array.isArray(detail.settings)
      ? detail.settings.join(", ")
      : "";
    if (code && settings) return `${code}: ${settings}`;
    if (code) return code;
  }

  return fallback;
}

function errorCode(payload, status) {
  if (payload && typeof payload === "object") {
    if (typeof payload.code === "string") return payload.code;
    if (payload.detail && typeof payload.detail.code === "string") {
      return payload.detail.code;
    }
  }
  return status ? `HTTP_${status}` : "API_ERROR";
}

async function parseResponsePayload(response) {
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw requestFailure(error);
  }
  if (!text.trim()) return { text, payload: null, malformed: false };

  try {
    return { text, payload: JSON.parse(text), malformed: false };
  } catch {
    return { text, payload: null, malformed: true };
  }
}

function requestFailure(error) {
  if (error instanceof ApiError) return error;
  if (error?.name === "AbortError") {
    return new ApiError("The request was cancelled.", {
      code: "REQUEST_ABORTED",
      cause: error,
    });
  }
  return new ApiError(
    "Could not reach the research service. Check your connection and try again.",
    { code: "NETWORK_ERROR", cause: error },
  );
}

async function fetchFromApi(path, init) {
  try {
    return await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
    });
  } catch (error) {
    throw requestFailure(error);
  }
}

async function requestJson(path, init = {}) {
  const response = await fetchFromApi(path, init);
  const parsed = await parseResponsePayload(response);

  if (!response.ok) {
    const fallback = parsed.malformed
      ? `The research service returned an error (${response.status}).`
      : response.statusText || "The research request failed.";
    throw new ApiError(messageFromPayload(parsed.payload, fallback), {
      status: response.status,
      statusText: response.statusText,
      code: errorCode(parsed.payload, response.status),
      details: parsed.payload,
    });
  }

  if (parsed.malformed || parsed.payload === null) {
    throw new ApiError("The research service returned an invalid response.", {
      status: response.status,
      statusText: response.statusText,
      code: "MALFORMED_RESPONSE",
      details: null,
    });
  }

  return parsed.payload;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJobCreatedPayload(value) {
  return (
    isRecord(value) &&
    typeof value.job_id === "string" &&
    value.job_id.trim().length > 0 &&
    JOB_STATUSES.has(value.status) &&
    Number.isInteger(value.total_people) &&
    value.total_people >= 0
  );
}

function isJobViewPayload(value) {
  return (
    isJobCreatedPayload(value) &&
    isRecord(value.counts) &&
    Object.values(value.counts).every(
      (count) => Number.isInteger(count) && count >= 0,
    ) &&
    typeof value.created_at === "string"
  );
}

function isFieldDecision(value) {
  if (!isRecord(value)) return false;
  const listKeys = [
    "supporting_claim_ids",
    "supporting_source_ids",
    "sources",
    "conflicting_claim_ids",
    "alternative_claim_ids",
    "review_reason_codes",
  ];
  return (
    (value.value === null || typeof value.value === "string") &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 100 &&
    (value.selected_claim_id === null ||
      typeof value.selected_claim_id === "string") &&
    typeof value.review_required === "boolean" &&
    isRecord(value.scoring_components) &&
    listKeys.every(
      (key) =>
        Array.isArray(value[key]) &&
        value[key].every((item) => typeof item === "string"),
    )
  );
}

function isSourceRecord(value) {
  return (
    isRecord(value) &&
    typeof value.source_id === "string" &&
    typeof value.requested_url === "string" &&
    typeof value.final_url === "string" &&
    typeof value.canonical_url === "string" &&
    typeof value.domain === "string" &&
    typeof value.title === "string" &&
    typeof value.source_type === "string"
  );
}

function isEvidenceClaim(value) {
  return (
    isRecord(value) &&
    typeof value.claim_id === "string" &&
    typeof value.source_id === "string" &&
    typeof value.raw_value === "string" &&
    typeof value.normalised_value === "string" &&
    typeof value.evidence_text === "string" &&
    typeof value.directness === "string" &&
    (value.temporal_context === null ||
      typeof value.temporal_context === "string")
  );
}

function isResearchResult(value) {
  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !isRecord(value.profile.fields) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.claims) ||
    !Array.isArray(value.usage)
  ) {
    return false;
  }

  return (
    typeof value.profile.profile_confidence === "number" &&
    typeof value.profile.coverage === "number" &&
    typeof value.profile.input_name === "string" &&
    typeof value.profile.review_required === "boolean" &&
    Number.isInteger(value.profile.sources_used) &&
    Object.values(value.profile.fields).every(isFieldDecision) &&
    value.sources.every(isSourceRecord) &&
    value.claims.every(isEvidenceClaim) &&
    value.usage.every(isRecord)
  );
}

function isPersonResult(value) {
  return (
    isRecord(value) &&
    typeof value.person_id === "string" &&
    Number.isInteger(value.row_index) &&
    isRecord(value.original_row) &&
    PERSON_STATUSES.has(value.status) &&
    (value.error_code === null || typeof value.error_code === "string") &&
    (value.result === null || isResearchResult(value.result))
  );
}

function isJobResultsPayload(value) {
  return (
    isRecord(value) &&
    typeof value.job_id === "string" &&
    value.job_id.trim().length > 0 &&
    JOB_STATUSES.has(value.status) &&
    Array.isArray(value.people) &&
    value.people.every(isPersonResult)
  );
}

async function validateResponse(promise, validator, responseName) {
  const payload = await promise;
  if (!validator(payload)) {
    throw new ApiError(
      `The research service returned an invalid ${responseName} response.`,
      { code: "MALFORMED_RESPONSE", details: null },
    );
  }
  return payload;
}

export function formatApiError(error) {
  if (error instanceof ApiError) return error.message;
  if (error?.name === "AbortError") return "The request was cancelled.";
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return "Something went wrong while contacting the research service.";
}

export function researchPerson(person, options = {}) {
  const payload =
    typeof person === "string" ? { full_name: person } : { ...person };
  return validateResponse(
    requestJson(`${API_ROOT}/research/person`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
      signal: options.signal,
    }),
    isJobCreatedPayload,
    "job",
  );
}

export function researchBatch(file, options = {}) {
  const form = new FormData();
  form.append("file", file);
  if (options.nameColumn?.trim()) {
    form.append("name_column", options.nameColumn.trim());
  }

  return validateResponse(
    requestJson(`${API_ROOT}/research/batch`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      signal: options.signal,
    }),
    isJobCreatedPayload,
    "job",
  );
}

export function getJob(jobId, options = {}) {
  return validateResponse(
    requestJson(pathForJob(jobId), {
      headers: { Accept: "application/json" },
      signal: options.signal,
    }),
    isJobViewPayload,
    "job status",
  );
}

export function getJobResults(jobId, options = {}) {
  return validateResponse(
    requestJson(pathForJob(jobId, "/results"), {
      headers: { Accept: "application/json" },
      signal: options.signal,
    }),
    isJobResultsPayload,
    "job results",
  );
}

export function cancelJob(jobId, options = {}) {
  return validateResponse(
    requestJson(pathForJob(jobId, "/cancel"), {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: options.signal,
    }),
    isJobViewPayload,
    "job status",
  );
}

function unquoteFilename(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

function filenameFromDisposition(disposition) {
  if (!disposition) return "";

  const extended = disposition.match(
    /(?:^|;)\s*filename\*\s*=\s*([^;]+)/i,
  );
  if (extended) {
    const encoded = unquoteFilename(extended[1]);
    const parts = encoded.match(/^([^']*)'[^']*'(.*)$/);
    const charset = parts?.[1]?.toLowerCase() ?? "";
    const value = parts ? parts[2] : encoded;
    if (!charset || charset === "utf-8") {
      try {
        return decodeURIComponent(value);
      } catch {
        // Fall through to the regular filename parameter.
      }
    }
  }

  const regular = disposition.match(
    /(?:^|;)\s*filename\s*=\s*("(?:\\.|[^"])*"|[^;]*)/i,
  );
  return regular ? unquoteFilename(regular[1]) : "";
}

function safeFilename(value, fallback) {
  const filename = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180)
    .replace(/[. ]+$/, "");
  return filename || fallback;
}

export async function downloadExport(jobId, format = "csv", options = {}) {
  if (format !== "csv" && format !== "xlsx") {
    throw new ApiError("Export format must be csv or xlsx.", {
      code: "INVALID_EXPORT_FORMAT",
    });
  }

  const path = `${pathForJob(jobId, "/export")}?${new URLSearchParams({ format })}`;
  const response = await fetchFromApi(path, {
    headers: {
      Accept:
        format === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    signal: options.signal,
  });

  if (!response.ok) {
    const parsed = await parseResponsePayload(response);
    const fallback = parsed.malformed
      ? `The export failed (${response.status}).`
      : response.statusText || "The export failed.";
    throw new ApiError(messageFromPayload(parsed.payload, fallback), {
      status: response.status,
      statusText: response.statusText,
      code: errorCode(parsed.payload, response.status),
      details: parsed.payload,
    });
  }

  let blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw requestFailure(error);
  }

  const fallback = `research-${String(jobId).trim()}.${format}`;
  const filename = safeFilename(
    filenameFromDisposition(response.headers.get("Content-Disposition")),
    fallback,
  );
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return { blob, filename };
}
