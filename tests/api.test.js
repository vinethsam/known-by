import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  ApiError,
  cancelJob,
  deleteLibraryFile,
  downloadExport,
  downloadLibraryFile,
  getJob,
  getJobResults,
  listLibraryFiles,
  researchBatch,
  researchPerson,
  saveJobToLibrary,
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

const savedFile = {
  file_id: "file/id",
  filename: "Forbes-2000_2026-09-29_0241.csv",
  format: "csv",
  saved_at: "2026-09-29T02:42:00Z",
  research_started_at: "2026-09-29T02:41:00Z",
  size_bytes: 128,
  list_name: "Forbes 2000",
};

function installDownloadHarness() {
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
  return {
    state: () => ({ clicked, downloadedAs, revoked }),
  };
}

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

  test("saves completed exports with the library request contract", async () => {
    const signal = new AbortController().signal;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return jsonResponse(savedFile, { status: 201 });
    };

    const result = await saveJobToLibrary("job/id", "csv", { signal });

    assert.equal(request.url, "/api/v1/jobs/job%2Fid/library");
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.signal, signal);
    assert.deepEqual(JSON.parse(request.init.body), {
      format: "csv",
      provenance: "none",
    });
    assert.equal(result.filename, savedFile.filename);
    assert.equal(new Headers(request.init.headers).has("Authorization"), false);
  });

  test("lists validated library metadata with bounded pagination", async () => {
    const signal = new AbortController().signal;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return jsonResponse([savedFile]);
    };

    const result = await listLibraryFiles({ limit: 25, offset: 50, signal });

    assert.equal(request.url, "/api/v1/library/files?limit=25&offset=50");
    assert.equal(request.init.signal, signal);
    assert.deepEqual(result, [savedFile]);

    globalThis.fetch = async () => {
      const { list_name: _omitted, ...withoutOptionalName } = savedFile;
      return jsonResponse([withoutOptionalName]);
    };
    assert.equal((await listLibraryFiles({ signal }))[0].list_name, undefined);

    globalThis.fetch = async () => jsonResponse([{ ...savedFile, size_bytes: "128" }]);
    await assert.rejects(listLibraryFiles({ signal }), {
      name: "ApiError",
      code: "MALFORMED_RESPONSE",
      message: "The research service returned an invalid library files response.",
    });
  });

  test("deletes library files through the encoded file route", async () => {
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return new Response(null, { status: 204 });
    };

    assert.equal(await deleteLibraryFile("file/id"), true);
    assert.equal(request.url, "/api/v1/library/files/file%2Fid");
    assert.equal(request.init.method, "DELETE");
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

    const download = installDownloadHarness();

    const result = await downloadExport("job-1", "csv");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = download.state();

    assert.equal(requestUrl, "/api/v1/jobs/job-1/export?format=csv");
    assert.equal(state.clicked, true);
    assert.equal(state.downloadedAs, "research results.csv");
    assert.equal(state.revoked, "blob:test-export");
    assert.equal(result.filename, "research results.csv");
    assert.ok(result.blob instanceof Blob);
  });

  test("downloads saved files and falls back to metadata without exposing IDs", async () => {
    let requestUrl;
    globalThis.fetch = async (url) => {
      requestUrl = url;
      return new Response(new Blob(["full_name\nAda Lovelace\n"]), {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      });
    };
    const download = installDownloadHarness();

    const result = await downloadLibraryFile(savedFile);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = download.state();

    assert.equal(requestUrl, "/api/v1/library/files/file%2Fid");
    assert.equal(state.downloadedAs, savedFile.filename);
    assert.equal(result.filename, savedFile.filename);
    assert.equal(result.filename.includes(savedFile.file_id), false);
  });

  test("normal export fallback filenames never reveal the job ID", async () => {
    globalThis.fetch = async () =>
      new Response(new Blob(["full_name\nAda Lovelace\n"]), {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      });
    const download = installDownloadHarness();

    const result = await downloadExport("secret-job-id", "csv");

    assert.equal(download.state().downloadedAs, "KnownBy-export.csv");
    assert.equal(result.filename, "KnownBy-export.csv");
    assert.equal(result.filename.includes("secret-job-id"), false);
  });
});
