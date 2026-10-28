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

export async function fetchTerminalResults(job, fetchResults, { signal, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) throw new DOMException("The request was cancelled.", "AbortError");
    const response = await fetchResults(job.jobId, { signal });
    if (response.people.length) return response;
    // Confirm empty responses rather than interpreting the first as final.
    if (attempt > 0 && !(Number(job.totalPeople) > 0)) return response;
    if (attempt < 2) await wait(250 * (attempt + 1));
  }
  throw new Error("Research finished, but its result records are not available yet. Please retry results.");
}
