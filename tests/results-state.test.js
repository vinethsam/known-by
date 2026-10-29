import assert from "node:assert/strict";
import { test } from "node:test";
import { canSaveJob, fetchTerminalResults, isTransientReadError, recoveryDelay, resultState } from "../src/results-state.js";
import { libraryRecordsJob } from "../src/library-records.js";

const person = { status: "review_required", result: { profile: { fields: { full_name: { value: "Ada Example" } } } } };
test("terminal hydration keeps the first empty response loading and retries once for real rows", async () => {
  const job = { jobId: "job", status: "completed", totalPeople: 1, results: null };
  assert.equal(resultState(job), "loading");
  let calls = 0;
  const response = await fetchTerminalResults(job, async () => {
    calls += 1;
    assert.equal(resultState(job), "loading");
    return { status: "completed", people: calls === 1 ? [] : [person] };
  }, { wait: async () => {} });
  assert.equal(calls, 2);
  assert.equal(resultState({ ...job, results: response }), "ready");
});
test("genuinely empty terminal results require confirmation and request failure is distinct", async () => {
  let calls = 0;
  const response = await fetchTerminalResults({ jobId: "empty", totalPeople: 0 }, async () => {
    calls += 1; return { people: [] };
  }, { wait: async () => {} });
  assert.equal(calls, 2);
  assert.equal(resultState({ results: response, resultsState: "empty" }), "empty");
  await assert.rejects(fetchTerminalResults({ jobId: "failed" }, async () => { throw new Error("Unauthorized"); }), /Unauthorized/);
  assert.equal(resultState({ resultsState: "error", error: "Unauthorized" }), "error");
});
test("missing expected records stop bounded retries without asserting a false empty result", async () => {
  let calls = 0;
  await assert.rejects(fetchTerminalResults({ jobId: "late", totalPeople: 50 }, async () => {
    calls += 1; return { people: [] };
  }, { wait: async () => {} }), /not available yet/);
  assert.equal(calls, 3);
});
test("terminal reads automatically recover beyond five failures without discarding progress", async () => {
  const job = { jobId: "recover", totalPeople: 100, counts: { completed: 37 } };
  const states = [];
  let calls = 0;
  const response = await fetchTerminalResults(job, async () => {
    calls += 1;
    if (calls <= 7) throw { status: 503, retryAfterMs: 32_000 };
    return { people: [person] };
  }, { wait: async (delay) => assert.equal(delay, 32_000), onRecovery: (state) => states.push(state) });
  assert.equal(calls, 8);
  assert.equal(job.counts.completed, 37);
  assert.equal(response.people[0], person);
  assert.equal(states.at(-1), "resuming");
  assert.ok(states.slice(0, -1).every((state) => state === "reconnecting"));
});
test("only transient reads retry and backoff respects Retry-After", async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isTransientReadError({ status }), true);
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(isTransientReadError({ status, code: "NETWORK_ERROR" }), false);
  for (const code of ["MALFORMED_RESPONSE", "REQUEST_ABORTED"]) assert.equal(isTransientReadError({ code }), false);
  assert.equal(recoveryDelay(1, null, () => 0.5), 2500);
  assert.equal(recoveryDelay(20, null, () => 1), 30_000);
  assert.equal(recoveryDelay(20, { retryAfterMs: 60_000 }, () => 0), 60_000);
  let calls = 0;
  await assert.rejects(fetchTerminalResults({ jobId: "permanent" }, async () => {
    calls += 1; throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }), /Unauthorized/);
  assert.equal(calls, 1);
});
test("cancellation interrupts recovery waits without making another request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = fetchTerminalResults({ jobId: "cancelled" }, async () => {
    calls += 1;
    throw { code: "NETWORK_ERROR" };
  }, { signal: controller.signal, onRecovery: () => queueMicrotask(() => controller.abort()) });
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});
test("saving requires useful terminal results and aligns partial eligibility with the backend", () => {
  const job = { jobId: "job", status: "partial", results: { people: [person] } };
  assert.equal(canSaveJob(job), true);
  assert.equal(canSaveJob({ ...job, status: "completed" }), true);
  for (const status of ["queued", "running", "cancelled", "failed"]) assert.equal(canSaveJob({ ...job, status }), false);
  assert.equal(canSaveJob({ ...job, results: null }), false);
  assert.equal(canSaveJob({ ...job, results: { people: [{ status: "failed", result: null, supplied_fields: { full_name: { value: "Seed" } } }] } }), false);
  assert.equal(canSaveJob({ ...job, status: "completed", results: { people: [{ status: "failed", result: null, supplied_fields: { full_name: { value: "Seed" } } }] } }), false);
  assert.equal(canSaveJob({ ...job, status: "completed", results: { people: [person, { status: "researching", result: null }] } }), false);
});
test("saved records retain per-field supplied certainty, conflicting values and missing legacy confidence", () => {
  const job = libraryRecordsJob({ file: { file_id: "file", filename: "saved.csv" }, offset: 50, records: [{
    full_name: "Ada Example", organisation: "New Organisation", organisation_confidence: 81,
    organisation_input_confidence: 100, organisation_provenance_status: "conflicting",
    organisation_supplied_values: '["Old Organisation"]', organisation_source_urls: "https://example.org/bio",
    job_title: "Architect", job_title_confidence: 0, job_title_input_confidence: 100, job_title_provenance_status: "supplied",
    review_required: true, status: "review_required", source_urls: "https://example.org/bio",
  }] });
  const saved = job.results.people[0];
  assert.equal(saved.row_index, 51);
  assert.equal(saved.result.profile.fields.full_name.confidence, null);
  assert.equal(saved.result.profile.fields.job_title.research_confidence, 0);
  assert.equal(saved.result.profile.fields.job_title.input_confidence, 100);
  assert.deepEqual(saved.result.profile.fields.organisation.supplied_values, ["Old Organisation"]);
  assert.equal(saved.result.profile.fields.organisation.review_required, true);
  assert.deepEqual(saved.result.claims, []);
});

test("saved high-confidence review flags survive and aggregate URLs are not claimed as field evidence", () => {
  const job = libraryRecordsJob({ file: { file_id: "f", filename: "legacy.xlsx" }, offset: 0, records: [{
    organisation: "Established Practice", organisation_confidence: 91,
    organisation_review_required: "Yes", organisation_review_reasons: "HISTORICAL_PROFESSIONAL_AFFILIATION;UNPAIRED_ROLE",
    source_urls: "https://example.org/whole-record",
  }] });
  const profile = job.results.people[0].result.profile;
  assert.equal(profile.fields.organisation.review_required, true);
  assert.deepEqual(profile.fields.organisation.review_reason_codes, ["HISTORICAL_PROFESSIONAL_AFFILIATION", "UNPAIRED_ROLE"]);
  assert.deepEqual(profile.fields.organisation.sources, []);
  assert.deepEqual(profile.saved_row_sources, ["https://example.org/whole-record"]);
});

test("legacy previews with blank standardized review columns retain confidence and provenance review rules", () => {
  const job = libraryRecordsJob({ file: { file_id: "legacy", filename: "legacy.csv" }, offset: 0, records: [{
    organisation: "Earlier Organisation", organisation_confidence: 40, organisation_review_required: "",
    job_title: "Architect", job_title_confidence: 90, job_title_provenance_status: "conflicting", job_title_review_required: "",
    university_name: "University of Ghana", university_name_confidence: 90, university_name_review_required: "",
    subject: "Architecture", subject_confidence: 40, subject_review_required: "No",
  }] });
  const fields = job.results.people[0].result.profile.fields;
  assert.equal(fields.organisation.review_required, true);
  assert.equal(fields.job_title.review_required, true);
  assert.equal(fields.university_name.review_required, false);
  assert.equal(fields.subject.review_required, false);
});
