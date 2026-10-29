const completedPersonStatuses = [
  "completed",
  "review_required",
  "failed",
  "cancelled",
];

const provenanceLabels = {
  supplied: "Supplied input; not independently verified",
  researched: "Independently researched",
  corroborated: "Supplied input corroborated by research",
  conflicting: "Supplied input conflicts with research",
  superseded: "Supplied input superseded by research",
  mixed: "Combined qualifications with different provenance; inspect supplied information",
};

export function getPersonProfile(person) {
  if (person?.result?.profile) return person.result.profile;
  if (person?.supplied_fields) return {
    fields: person.supplied_fields,
    seed_attributes: person.seed_attributes ?? [],
    profile_confidence: 0, coverage: 0, sources_used: 0,
    review_required: Object.values(person.supplied_fields).some((field) => field?.review_required), status: person.status,
  };
  return null;
}

export function getFieldProvenanceLabel(decision) {
  return provenanceLabels[decision?.provenance_status] || "";
}

export function getRelationshipLabel(decision) {
  const details = decision?.scoring_components;
  const historical = details?.relationship_temporal_status === "historical" ||
    decision?.review_reason_codes?.includes("HISTORICAL_PROFESSIONAL_AFFILIATION");
  const type = {
    principal_professional_practice: "Principal professional practice",
    secondary_academic_role: "Secondary academic affiliation",
  }[details?.relationship_type];
  if (historical) return `${type || "Professional affiliation"} · Historical`;
  if (details?.relationship_temporal_status === "current") return `${type || "Professional affiliation"} · Current`;
  if (type) return `${type} · Timing unspecified`;
  return "";
}

export function getFieldConfidence(decision) {
  if (decision?.provenance_status === "supplied" && decision.value && !(decision.research_confidence > 0)) {
    return { value: decision.input_confidence ?? 100, label: "input certainty" };
  }
  if (typeof decision?.research_confidence === "number") {
    return { value: decision.research_confidence, label: "research confidence" };
  }
  return { value: decision?.confidence, label: "confidence" };
}

export function formatInputValue(value) {
  if (value === null || value === undefined) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function formatScoringValue(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.length ? value.map(formatScoringValue).join(", ") : "—";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length
      ? entries
          .map(([key, nested]) => `${key.replaceAll("_", " ")}: ${formatScoringValue(nested)}`)
          .join(" · ")
      : "—";
  }
  return String(value);
}

export function getConnectionState(job) {
  if (job?.monitoringStopped) return null;
  return job?.connectionState ||
    (["queued", "running"].includes(job?.status) ? job?.jobView?.recovery_state : null) || null;
}

export function getJobProgress(job) {
  const total = Number(job?.totalPeople) || 0;
  const counts = job?.counts;
  const finished = counts
    ? Math.min(
        total,
        completedPersonStatuses.reduce(
          (sum, status) => sum + (Number(counts[status]) || 0),
          0,
        ),
      )
    : 0;
  const researching = counts ? Number(counts.researching) || 0 : 0;
  const isBatch = job?.kind === "file";
  const connection = getConnectionState(job);
  const stage = connection === "reconnecting" ? "Reconnecting" : connection === "resuming" ? "Resuming research" : {
    submitting: isBatch ? "Preparing batch" : "Submitting research request",
    queued: "Waiting for research to start",
    running: isBatch ? "Researching people" : "Researching person",
    completed: "Research complete",
    partial: total > 0 && finished === total ? "Research completed with issues" : "Research partially complete",
    completed_with_issues: "Research completed with issues",
    failed: "Research failed",
    cancelled: "Research cancelled",
  }[job?.status] ?? "Research status unavailable";

  return {
    total,
    finished,
    researching,
    stage,
    percentage: total ? Math.round((finished / total) * 100) : 0,
  };
}

export function getJobProgressSummary(job) {
  const progress = getJobProgress(job);
  if (job?.kind !== "file" || progress.total <= 0) return progress.stage;

  const count = `${progress.finished} of ${progress.total} people finished`;
  const active = progress.researching > 0
    ? ` · ${progress.researching} in progress`
    : "";
  return `${progress.stage} · ${count}${active}`;
}

export function getSavedBy(file) {
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const identity = (value) => {
    if (typeof value === "string") return text(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    return [value.display_name, value.name, value.username, value.email]
      .map(text).find(Boolean) || "";
  };

  return [
    file?.saved_by,
    file?.added_by,
    file?.creator_name,
    file?.creator_display_name,
    file?.created_by,
    file?.creator,
    file?.saved_by_name,
    file?.added_by_name,
    file?.creator_username,
    file?.creator_email,
  ].map(identity).find(Boolean) || "";
}

const librarySavedDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function formatLibrarySavedDate(value, locale) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : (locale === undefined
      ? librarySavedDateFormatter
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium" })).format(date);
}

export function formatLibraryError(error, fallback = "Unable to complete this library action. Please try again.") {
  if (error?.code === "NETWORK_ERROR") {
    return "Could not reach Shared Library. Check your connection and try again.";
  }
  return {
    401: "Shared Library access requires authorization. Contact your administrator.",
    403: "You do not have permission to use Shared Library.",
    404: "This research or saved file is no longer available. Refresh and try again.",
    409: "This action is not available in the current state. Refresh and try again.",
    413: "This research export is too large to save to Shared Library.",
    429: "Shared Library is busy. Please try again shortly.",
    507: "Shared Library is full. Remove an unneeded file and try again.",
  }[error?.status] || fallback;
}
