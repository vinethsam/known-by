import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatScoringValue,
  formatLibrarySavedDate,
  formatLibraryError,
  getJobProgress,
  getJobProgressSummary,
  getSavedBy,
} from "../src/presentation.js";

test("scoring diagnostics round only display values", () => {
  const raw = 0.8400000000000001;
  assert.equal(formatScoringValue(raw), "0.84");
  assert.equal(raw, 0.8400000000000001);
  assert.equal(formatScoringValue(2), "2");
  assert.equal(formatScoringValue("evidence-v2"), "evidence-v2");
  assert.equal(formatScoringValue(null), "—");
});

test("batch progress uses backend counts without inventing a research stage", () => {
  const progress = getJobProgress({
    kind: "file",
    status: "running",
    totalPeople: 100,
    counts: {
      completed: 65,
      review_required: 2,
      failed: 1,
      cancelled: 0,
      researching: 3,
      queued: 29,
    },
  });

  assert.deepEqual(progress, {
    total: 100,
    finished: 68,
    researching: 3,
    stage: "Researching people",
    percentage: 68,
  });
});

test("failed and review-required people count as finished", () => {
  const progress = getJobProgress({
    kind: "file",
    status: "partial",
    totalPeople: 3,
    counts: { completed: 1, review_required: 1, failed: 1 },
  });

  assert.equal(progress.finished, 3);
  assert.equal(progress.percentage, 100);
  assert.equal(progress.stage, "Research partially complete");
});

test("long-running batches show a human-readable current and total count", () => {
  assert.equal(
    getJobProgressSummary({
      kind: "file",
      status: "running",
      totalPeople: 20,
      counts: { completed: 11, review_required: 1, researching: 2 },
    }),
    "Researching people · 12 of 20 people finished · 2 in progress",
  );
  assert.equal(
    getJobProgressSummary({ kind: "file", status: "queued", totalPeople: 20 }),
    "Waiting for research to start · 0 of 20 people finished",
  );
});

test("saved-by identity is shown only when the service provides it", () => {
  assert.equal(getSavedBy({ saved_by: "  Jane Doe  " }), "Jane Doe");
  assert.equal(getSavedBy({ added_by: "Alex" }), "Alex");
  assert.equal(getSavedBy({ filename: "KnownBy.xlsx" }), "");
});

test("saved-by uses genuine structured creator metadata and prefers a readable name", () => {
  assert.equal(getSavedBy({ saved_by: { display_name: "  Jane Doe ", email: "jane@example.test" } }), "Jane Doe");
  assert.equal(getSavedBy({ created_by: { username: "alex", email: "alex@example.test" } }), "alex");
  assert.equal(getSavedBy({ creator: { email: "sam@example.test" } }), "sam@example.test");
  assert.equal(getSavedBy({ creator_email: "rory@example.test" }), "rory@example.test");
});

test("empty identity aliases do not mask usable metadata or invent an identity", () => {
  assert.equal(getSavedBy({ saved_by: " ", added_by: null, creator_name: "Taylor" }), "Taylor");
  assert.equal(getSavedBy({ saved_by: {}, created_by: { name: "Ari" } }), "Ari");
  assert.equal(getSavedBy({ created_by: { id: "internal-user-id" } }), "");
  assert.equal(getSavedBy({ saved_by: ["not an identity"], creator_name: 42 }), "");
  assert.equal(getSavedBy(null), "");
});

test("library dates use the supplied save timestamp and handle older missing metadata", () => {
  assert.equal(formatLibrarySavedDate("2026-10-23T12:00:00Z", "en-GB"), "23 Oct 2026");
  assert.equal(formatLibrarySavedDate(null, "en-GB"), "Date unavailable");
  assert.equal(formatLibrarySavedDate("invalid-date", "en-GB"), "Date unavailable");
});

test("repeated library date renders reuse the default formatter and preserve locale overrides", () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  const value = "2026-10-23T12:00:00Z";
  const expected = new NativeDateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  let constructions = 0;
  Intl.DateTimeFormat = new Proxy(NativeDateTimeFormat, {
    construct(target, args) {
      constructions += 1;
      return Reflect.construct(target, args);
    },
  });
  try {
    for (let row = 0; row < 100; row += 1) {
      assert.equal(formatLibrarySavedDate(value), expected);
    }
    assert.equal(constructions, 0);
    assert.equal(formatLibrarySavedDate(value, "en-GB"), "23 Oct 2026");
    assert.equal(formatLibrarySavedDate(value, "en-US"), "Oct 23, 2026");
    assert.equal(constructions, 2);
  } finally {
    Intl.DateTimeFormat = NativeDateTimeFormat;
  }
});

test("library errors explain safe actions without exposing backend details", () => {
  const raw = "SQL failed for secret storage-id and internal job-id";
  assert.equal(formatLibraryError({ status: 500, message: raw }, "Unable to save this result."), "Unable to save this result.");
  assert.equal(formatLibraryError({ message: raw }, "Unable to load files."), "Unable to load files.");
  assert.match(formatLibraryError({ status: 403, message: raw }), /permission/);
  assert.match(formatLibraryError({ code: "NETWORK_ERROR", message: raw }), /connection/);
  assert.match(formatLibraryError({ status: 404, message: raw }), /no longer available/);
});
