import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

const apiRoot = "https://research.example.test/v1";
globalThis.__KNOWNBY_API_ROOT__ = apiRoot;
const {
  ApiError,
  authenticateGoogle,
  cancelJob,
  deleteLibraryFile,
  downloadExport,
  downloadLibraryFile,
  getJob,
  getJobResults,
  getAuthConfig,
  getSignedInUser,
  getLibraryRecords,
  listLibraryFiles,
  researchBatch,
  researchPerson,
  saveJobToLibrary,
  signOut,
  subscribeToSignInRequired,
} = await import("../src/api.js");

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  signOut();
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
  available_formats: ["csv", "xlsx"],
  can_delete: false,
};

test("saved records use authenticated pagination and reject malformed or unauthorized responses", async () => {
  let request;
  const payload = { file: savedFile, records: [{ full_name: "Ada Example" }], total: 51, offset: 50, limit: 50, has_more: false };
  globalThis.fetch = async (url, init) => { request = { url, init }; return jsonResponse(payload); };
  assert.deepEqual(await getLibraryRecords("file/id", { offset: 50, q: "Ada & Example" }), payload);
  assert.equal(request.url, `${apiRoot}/library/files/file%2Fid/records?limit=50&offset=50&q=Ada+%26+Example`);
  assert.equal(request.init.credentials, "same-origin");
  assert.throws(() => getLibraryRecords("id", { limit: 101 }), /Invalid saved-record page/);
  globalThis.fetch = async () => jsonResponse({ ...payload, records: "bad" });
  await assert.rejects(getLibraryRecords("id"), { code: "MALFORMED_RESPONSE" });
  globalThis.fetch = async () => jsonResponse({ detail: "Authentication required" }, { status: 401 });
  await assert.rejects(getLibraryRecords("id"), { status: 401 });
});

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
  const googleUser = () => ({ authentication: "google", subject: "google-user-id",
    email: "approved@example.test", can_delete: false, expires_at: Math.floor(Date.now() / 1000) + 3600 });

  test("rejects a missing secure API root before making any request", async () => {
    delete globalThis.__KNOWNBY_API_ROOT__;
    globalThis.fetch = () => assert.fail("An unconfigured app must not make an API request");
    try {
      const unconfigured = await import("../src/api.js?no-api-root");
      await assert.rejects(unconfigured.getAuthConfig(), { code: "INVALID_API_CONFIGURATION" });
    } finally {
      globalThis.__KNOWNBY_API_ROOT__ = apiRoot;
    }
  });

  test("verifies Google sign-in before retaining a memory-only credential and authenticates reads and downloads", async () => {
    const requests = [];
    const user = googleUser();
    const config = { enabled: true, google_client_id: "public-client.apps.googleusercontent.com" };
    const harness = installDownloadHarness();
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/auth/config")) return jsonResponse(config);
      if (url.endsWith("/auth/me")) {
        assert.equal(getSignedInUser(), null);
        return jsonResponse(user);
      }
      if (url.includes("/export?")) return new Response("Full Name\nExample\n");
      return jsonResponse([]);
    };
    assert.deepEqual(await getAuthConfig(), config);
    assert.deepEqual(await authenticateGoogle("per-user-id-token"), user);
    assert.deepEqual(getSignedInUser(), user);
    await listLibraryFiles();
    await downloadExport("saved-job", "csv");
    assert.equal(harness.state().clicked, true);
    assert.equal(new Headers(requests[0].init.headers).has("Authorization"), false);
    for (const request of requests.slice(1)) {
      assert.equal(new Headers(request.init.headers).get("Authorization"), "Bearer per-user-id-token");
      assert.equal(request.init.credentials, "same-origin");
    }
    signOut();
    assert.equal(getSignedInUser(), null);
    await listLibraryFiles();
    assert.equal(new Headers(requests.at(-1).init.headers).has("Authorization"), false);
  });

  test("rejected or expired Google credentials are not retained and sign-out cancels pending sign-in", async () => {
    globalThis.fetch = async () => jsonResponse({ detail: "Account is not approved" }, { status: 403 });
    await assert.rejects(authenticateGoogle("unapproved-token"), { status: 403 });
    assert.equal(getSignedInUser(), null);
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init.headers).has("Authorization"), false);
      return jsonResponse([]);
    };
    await listLibraryFiles();
    globalThis.fetch = async () => jsonResponse({ ...googleUser(), expires_at: 1 });
    await assert.rejects(authenticateGoogle("expired-token"), { code: "MALFORMED_RESPONSE" });
    assert.equal(getSignedInUser(), null);
    let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    const pending = authenticateGoogle("late-token");
    signOut();
    finish(jsonResponse(googleUser()));
    assert.equal(await pending, null);
    assert.equal(getSignedInUser(), null);
  });

  test("an unauthorized response clears the active credential and requests sign-in", async () => {
    globalThis.fetch = async () => jsonResponse(googleUser());
    await authenticateGoogle("expired-by-server-token");
    let prompted = 0;
    const unsubscribe = subscribeToSignInRequired(() => { prompted += 1; });
    try {
      globalThis.fetch = async () => jsonResponse({ detail: "Authentication required" }, { status: 401 });
      await assert.rejects(listLibraryFiles(), { status: 401 });
      assert.equal(getSignedInUser(), null);
      assert.equal(prompted, 1);
      globalThis.fetch = async (_url, init) => {
        assert.equal(new Headers(init.headers).has("Authorization"), false);
        return jsonResponse([]);
      };
      await listLibraryFiles();
    } finally {
      unsubscribe();
    }
  });

  test("a late unauthorized request cannot sign out or prompt over a newer verified account", async () => {
    globalThis.fetch = async () => jsonResponse(googleUser());
    await authenticateGoogle("old-user-token");
    let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    const oldRead = listLibraryFiles();
    const newUser = { ...googleUser(), subject: "new-user-id" };
    globalThis.fetch = async () => jsonResponse(newUser);
    await authenticateGoogle("new-user-token");
    let prompted = false;
    const unsubscribe = subscribeToSignInRequired(() => { prompted = true; });
    try {
      finish(jsonResponse({ detail: "Expired token" }, { status: 401 }));
      await assert.rejects(oldRead, { status: 401 });
      assert.deepEqual(getSignedInUser(), newUser);
      assert.equal(prompted, false);
    } finally {
      unsubscribe();
    }
  });

  test("uses the person contract and the configured HTTPS API URL", async () => {
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

    assert.equal(request.url, `${apiRoot}/research/person`);
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

    assert.equal(request.url, `${apiRoot}/research/batch`);
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.body.get("file"), file);
    assert.equal(request.init.body.get("name_column"), "name");
    assert.equal(new Headers(request.init.headers).has("Content-Type"), false);
    assert.equal(new Headers(request.init.headers).has("Authorization"), false);
  });

  test("uploads rich CSV and XLSX files unchanged, including unknown and administrative columns", async () => {
    const csv = "Full Name,University,Field of Study,Previous Employer,LIST_NAME,Custom Attribute\r\nAda Example,Example University,Physics,Example Company,Batch A,Original value\r\n";
    // XLSX is an opaque ZIP payload to the browser transport, just like the real
    // workbook. Parsing and column normalization belong to the backend.
    const fixtures = [
      new File([csv], "rich.csv", { type: "text/csv" }),
      new File([new Uint8Array([80, 75, 3, 4, 0, 255, 128, 13, 10])], "rich.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ];
    const uploaded = [];
    globalThis.fetch = async (_url, init) => {
      uploaded.push(init.body.get("file"));
      return jsonResponse({ job_id: "rich-job", status: "queued", total_people: 1 });
    };

    for (const file of fixtures) await researchBatch(file);

    for (const [index, file] of fixtures.entries()) {
      assert.equal(uploaded[index], file);
      assert.deepEqual(await uploaded[index].arrayBuffer(), await file.arrayBuffer());
    }
    assert.equal(await uploaded[0].text(), csv);
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
        `${apiRoot}/jobs/job%2Fid`,
        `${apiRoot}/jobs/job%2Fid/results`,
        `${apiRoot}/jobs/job%2Fid/cancel`,
      ],
    );
    assert.equal(requests[2].init.method, "POST");
  });

  test("retains supplied input and provenance without changing legacy result compatibility", async () => {
    const decision = {
      value: "Researched University", confidence: 87, selected_claim_id: null,
      review_required: true, scoring_components: {}, supporting_claim_ids: [],
      supporting_source_ids: [], sources: [], conflicting_claim_ids: [],
      alternative_claim_ids: [], review_reason_codes: [],
    };
    const profile = {
      input_name: "Test Person", profile_confidence: 60, coverage: 16.67,
      review_required: true, sources_used: 0, fields: { university_name: decision },
    };
    const payload = {
      ...jobResults,
      people: [{
        person_id: "rich-person", row_index: 1, status: "review_required", error_code: null,
        original_row: { "Full Name": "Test Person", University: "Supplied University", LIST_NAME: "Batch A" },
        result: { profile, sources: [], claims: [], usage: [] },
      }],
    };
    globalThis.fetch = async () => jsonResponse(payload);
    assert.deepEqual(await getJobResults("job/id"), payload);

    Object.assign(decision, {
      supplied_values: ["Supplied University"], input_confidence: 100,
      research_confidence: 87, provenance_status: "conflicting",
    });
    profile.seed_attributes = [
      { column: "University", value: "Supplied University", field: "university_name", category: "biographical", input_confidence: 100 },
      { column: "LIST_NAME", value: "Batch A", field: null, category: "administrative", input_confidence: 100 },
      { column: "Custom Attribute", value: { nested: ["original", 42] }, field: null, category: "unknown", input_confidence: 100 },
    ];
    assert.deepEqual(await getJobResults("job/id"), payload);
    assert.equal(profile.profile_confidence, 60);
    assert.equal(profile.coverage, 16.67);

    for (const malformed of [
      { supplied_values: "not an array" }, { input_confidence: 90 },
      { research_confidence: 101 }, { provenance_status: "verified_by_input" },
    ]) {
      globalThis.fetch = async () => jsonResponse({
        ...payload,
        people: [{ ...payload.people[0], result: { ...payload.people[0].result,
          profile: { ...profile, fields: { university_name: { ...decision, ...malformed } } },
        } }],
      });
      await assert.rejects(getJobResults("job/id"), { code: "MALFORMED_RESPONSE" });
    }
    globalThis.fetch = async () => jsonResponse({ ...payload,
      people: [{ ...payload.people[0], result: { ...payload.people[0].result,
        profile: { ...profile, seed_attributes: { University: "wrong shape" } },
      } }],
    });
    await assert.rejects(getJobResults("job/id"), { code: "MALFORMED_RESPONSE" });
  });

  test("saves completed exports with the library request contract", async () => {
    const signal = new AbortController().signal;
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return jsonResponse(savedFile, { status: 201 });
    };

    const result = await saveJobToLibrary("job/id", { signal });

    assert.equal(request.url, `${apiRoot}/jobs/job%2Fid/library`);
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.signal, signal);
    assert.deepEqual(JSON.parse(request.init.body), {
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

    assert.equal(request.url, `${apiRoot}/library/files?limit=25&offset=50`);
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

  test("Save to Database requires both formats and reports rejected or incomplete saves", async () => {
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return jsonResponse({ ...savedFile, format: "xlsx", filename: "KnownBy_2026-10-22_1200.xlsx" }, { status: 201 });
    };
    const saved = await saveJobToLibrary("completed-job");
    assert.deepEqual(JSON.parse(request.init.body), { provenance: "none" });
    assert.equal(saved.format, "xlsx");
    globalThis.fetch = async () => jsonResponse({ ...savedFile, available_formats: ["csv"] }, { status: 201 });
    await assert.rejects(saveJobToLibrary("incomplete-job"), { code: "MALFORMED_RESPONSE" });

    globalThis.fetch = async () => jsonResponse({ detail: "Only completed jobs can be saved" }, { status: 409 });
    await assert.rejects(saveJobToLibrary("unfinished-job"), {
      status: 409,
      message: "Only completed jobs can be saved",
    });
  });

  test("library requests retain server creator metadata and use the existing authenticated transport", async () => {
    const files = [
      { ...savedFile, file_id: "first", creator: { display_name: "First Test Saver", email: "first@example.test" } },
      { ...savedFile, file_id: "second", saved_by: { display_name: "Second Test Saver" } },
    ];
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(init.method === "POST" ? files[0] : files);
    };
    assert.deepEqual(await listLibraryFiles(), files);
    assert.deepEqual(await saveJobToLibrary("test-job"), files[0]);
    for (const { init } of requests) {
      assert.equal(init.credentials, "same-origin");
      assert.equal(init.cache, "no-store");
      assert.equal(new Headers(init.headers).has("Authorization"), false);
    }

    globalThis.fetch = async () => jsonResponse({ detail: "Unauthorized" }, { status: 401 });
    await assert.rejects(listLibraryFiles(), { status: 401 });
    await assert.rejects(saveJobToLibrary("test-job"), { status: 401 });
    await assert.rejects(downloadLibraryFile(savedFile), { status: 401 });
    await assert.rejects(deleteLibraryFile(savedFile.file_id), { status: 401 });
  });

  test("deletes library files through the encoded file route", async () => {
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return new Response(null, { status: 204 });
    };

    assert.equal(await deleteLibraryFile("file/id"), true);
    assert.equal(request.url, `${apiRoot}/library/files/file%2Fid`);
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

  test("status reads accept additive recovery metadata and retain Retry-After", async () => {
    const payload = { ...jobView, recovery_state: "reconnecting", recovery_reason: "DATABASE_UNAVAILABLE", retry_at: "2026-10-29T12:00:00Z" };
    globalThis.fetch = async () => jsonResponse(payload);
    assert.deepEqual(await getJob("job-1"), payload);
    globalThis.fetch = async () => jsonResponse({ detail: "Temporarily unavailable" }, { status: 503, headers: { "Retry-After": "45" } });
    await assert.rejects(getJob("job-1"), { status: 503, retryAfterMs: 45_000 });
    globalThis.fetch = async () => jsonResponse({ ...payload, recovery_state: "unknown" });
    await assert.rejects(getJob("job-1"), { code: "MALFORMED_RESPONSE" });
  });

  test("hung status reads time out and explicit cancellation stays distinct", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    globalThis.fetch = async (_url, { signal }) => new Promise((_, reject) => {
      if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      else signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const timeout = assert.rejects(getJob("job-1"), { code: "READ_TIMEOUT" });
    t.mock.timers.tick(30_000);
    await timeout;
    const controller = new AbortController();
    const cancellation = assert.rejects(getJobResults("job-1", { signal: controller.signal }), { code: "REQUEST_ABORTED" });
    controller.abort();
    await cancellation;
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

    assert.equal(requestUrl, `${apiRoot}/jobs/job-1/export?format=csv`);
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

    assert.equal(requestUrl, `${apiRoot}/library/files/file%2Fid`);
    assert.equal(state.downloadedAs, savedFile.filename);
    assert.equal(result.filename, savedFile.filename);
    assert.equal(result.filename.includes(savedFile.file_id), false);
    const alternate = await downloadLibraryFile(savedFile, { format: "xlsx" });
    assert.equal(requestUrl, `${apiRoot}/library/files/file%2Fid?format=xlsx`);
    assert.equal(alternate.filename, savedFile.filename.replace(/\.csv$/, ".xlsx"));
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
