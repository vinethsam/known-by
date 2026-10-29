// A terminal job status and its result payload arrive in separate requests.
// Keep that gap explicit so an unhydrated result cannot render as an empty one.
export function resultState(job) {
  if (job?.results?.people?.length) return "ready";
  if (job?.resultsState) return job.resultsState;
  if (job?.results) return "empty";
  if (job?.error) return "error";
  return "loading";
}

export function canSaveJob(job) {
  const people = job?.results?.people;
  return Boolean(job?.jobId && ["completed", "partial", "completed_with_issues"].includes(job.status) &&
    resultState(job) === "ready" && Array.isArray(people) &&
    people.every((person) => !["queued", "researching"].includes(person.status)) &&
    people.some((person) => person.result != null) &&
    (job.status === "completed" || people.some((person) =>
      ["completed", "review_required"].includes(person.status) && person.result)) && people.some((person) =>
      Object.values(person.result?.profile?.fields ?? person.supplied_fields ?? {}).some((field) => field?.value)));
}

export function isTransientReadError(error) {
  if (error?.code === "REQUEST_ABORTED" || error?.name === "AbortError" ||
    [400, 401, 403, 404, 409, 422].includes(error?.status)) return false;
  return ["NETWORK_ERROR", "READ_TIMEOUT"].includes(error?.code) ||
    [408, 429, 500, 502, 503, 504].includes(error?.status);
}

export function recoveryDelay(attempt, error, random = Math.random) {
  const backoff = Math.min(30_000, 2500 * 2 ** Math.min(Math.max(attempt - 1, 0), 4));
  return Math.max(Math.round(Math.min(30_000, backoff * (0.8 + random() * 0.4))), error?.retryAfterMs || 0);
}

function waitForRecovery(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("The request was cancelled.", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("The request was cancelled.", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchTerminalResults(job, fetchResults, { signal, wait = waitForRecovery, onRecovery = () => {} } = {}) {
  let attempt = 0;
  let failures = 0;
  while (attempt < 3) {
    if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
    let response;
    try {
      response = await fetchResults(job.jobId, { signal });
    } catch (error) {
      if (!isTransientReadError(error)) throw error;
      failures += 1;
      onRecovery("reconnecting");
      await wait(recoveryDelay(failures, error), signal);
      continue;
    }
    if (failures) { onRecovery("resuming"); failures = 0; }
    if (response.people.length) return response;
    // Confirm empty responses rather than interpreting the first as final.
    if (attempt > 0 && !(Number(job.totalPeople) > 0)) return response;
    if (attempt < 2) await wait(250 * (attempt + 1), signal);
    attempt += 1;
  }
  throw new Error("Research finished, but its result records are not available yet. Please retry results.");
}
