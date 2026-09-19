import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  ApiError,
  cancelJob,
  downloadExport,
  getJob,
  getJobResults,
  researchBatch,
  researchPerson,
} from "../src/api.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const jobView = {
  job_id: "job/id",
  status: "running",
  total_people: 1,
  counts: {
    queued: 0,
    researching: 1,
    completed: 0,
    failed: 0,
    review_required: 0,
    cancelled: 0,
  },
  created_at: "2026-09-19T12:00:00Z",
  started_at: "2026-09-19T12:00:01Z",
  completed_at: null,
};

const jobResults = {
  job_id: "job/id",
  status: "completed",
  people: [],
};

describe("KnownBy browser API", { concurrency: false }, () => {
  test("uses the person contract and only the relative proxy URL", async () => {
    const signal = new AbortController().signal;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return jsonResponse({ job_id: "job-1", status: "queued", total_people: 1 });
    };

    const result = await researchPerson(
      { full_name: "Ada Lovelace", organisation: "Analytical Engines" },
      { signal },
    );

    assert.equal(request.url, "/api/v1/research/person");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.signal, signal);
    assert.deepEqual(JSON.parse(request.init.body), {
      full_name: "Ada Lovelace",
      organisation: "Analytical Engines",
    });
    assert.equal(new Headers(request.init.headers).has("Authorization"), false);
    assert.equal(result.job_id, "job-1");
  });

  test("sends batch files as browser-owned multipart data", async () => {
    const file = new File(["name\nAda Lovelace\n"], "people.csv", {
      type: "text/csv",
    });
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return jsonResponse({ job_id: "job-2", status: "queued", total_people: 1 });
    };

    await researchBatch(file, { nameColumn: "name" });

    assert.equal(request.url, "/api/v1/research/batch");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.body.get("file"), file);
    assert.equal(request.init.body.get("name_column"), "name");
    assert.equal(new Headers(request.init.headers).has("Content-Type"), false);
    assert.equal(new Headers(request.init.headers).has("Authorization"), false);
  });

  test("uses encoded job paths for status, results, and cancellation", async () => {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(url.endsWith("/results") ? jobResults : jobView);
    };

    await getJob("job/id");
    await getJobResults("job/id");
    await cancelJob("job/id");

    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        "/api/v1/jobs/job%2Fid",
        "/api/v1/jobs/job%2Fid/results",
        "/api/v1/jobs/job%2Fid/cancel",
      ],
    );
    assert.equal(requests[2].init.method, "POST");
  });

  test("formats FastAPI validation errors without exposing request data", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        {
          detail: [
            {
              loc: ["body", "full_name"],
              msg: "String should have at least 2 characters",
              type: "string_too_short",
            },
          ],
        },
        { status: 422, statusText: "Unprocessable Entity" },
      );

    await assert.rejects(
      researchPerson({ full_name: "A" }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 422);
        assert.equal(error.code, "HTTP_422");
        assert.equal(
          error.message,
          "full name: String should have at least 2 characters",
        );
        return true;
      },
    );
  });

  test("reports network and malformed successful responses consistently", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("socket details that should stay internal");
    };
    await assert.rejects(getJob("job-1"), {
      name: "ApiError",
      code: "NETWORK_ERROR",
      message:
        "Could not reach the research service. Check your connection and try again.",
    });

    globalThis.fetch = async () =>
      new Response("<html>not json</html>", { status: 200 });
    await assert.rejects(getJob("job-1"), {
      name: "ApiError",
      code: "MALFORMED_RESPONSE",
      message: "The research service returned an invalid response.",
    });

    globalThis.fetch = async () => jsonResponse({});
    await assert.rejects(researchPerson({ full_name: "Ada Lovelace" }), {
      name: "ApiError",
      code: "MALFORMED_RESPONSE",
      message: "The research service returned an invalid job response.",
    });

    globalThis.fetch = async () =>
      jsonResponse({
        job_id: "job-1",
        status: "completed",
        people: {},
      });
    await assert.rejects(getJobResults("job-1"), {
      name: "ApiError",
      code: "MALFORMED_RESPONSE",
      message: "The research service returned an invalid job results response.",
    });
  });

  test("downloads exports with a safely parsed server filename", async () => {
    let requestUrl;
    globalThis.fetch = async (url) => {
      requestUrl = url;
      return new Response(new Blob(["full_name\nAda Lovelace\n"]), {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition":
            "attachment; filename*=UTF-8'en'research%20results.csv",
        },
      });
    };

    let clicked = false;
    let downloadedAs = "";
    let revoked = "";
    const link = {
      hidden: false,
      href: "",
      download: "",
      click() {
        clicked = true;
        downloadedAs = this.download;
      },
      remove() {},
    };
    globalThis.document = {
      createElement: () => link,
      body: { append() {} },
    };
    URL.createObjectURL = () => "blob:test-export";
    URL.revokeObjectURL = (value) => {
      revoked = value;
    };

    const result = await downloadExport("job-1", "csv");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(requestUrl, "/api/v1/jobs/job-1/export?format=csv");
    assert.equal(clicked, true);
    assert.equal(downloadedAs, "research results.csv");
    assert.equal(revoked, "blob:test-export");
    assert.equal(result.filename, "research results.csv");
    assert.ok(result.blob instanceof Blob);
  });
});
