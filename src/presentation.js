const completedPersonStatuses = [
  "completed",
  "review_required",
  "failed",
  "cancelled",
];

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
  const stage = {
    submitting: isBatch ? "Preparing batch" : "Submitting research request",
    queued: "Waiting for research to start",
    running: isBatch ? "Researching people" : "Researching person",
    completed: "Research complete",
    partial: "Research partially complete",
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
