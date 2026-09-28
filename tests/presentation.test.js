import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatScoringValue,
  getJobProgress,
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
