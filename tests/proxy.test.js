import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isAllowedProxyRoute,
  isSameOriginProxyRequest,
  resolveBackendUrl,
} from "../vite.config.js";

test("resolves the public production fallback while keeping development overrides", () => {
  assert.deepEqual(resolveBackendUrl({}, { production: true }), {
    target: "https://known-by-backend-production.up.railway.app",
  });
  assert.deepEqual(resolveBackendUrl({ BACKEND_API_URL: " http://127.0.0.1:8000/ " }), {
    target: "http://127.0.0.1:8000",
  });
  assert.deepEqual(resolveBackendUrl({ VITE_BACKEND_API_URL: "https://configured.example/" }, { production: true }), {
    target: "https://configured.example",
  });
  assert.deepEqual(resolveBackendUrl({ BACKEND_API_URL: "https://canonical.example", VITE_BACKEND_API_URL: "https://alias.example" }), {
    target: "https://canonical.example",
  });
  assert.equal(resolveBackendUrl({}).error, "BACKEND_API_URL is not configured");
});

test("rejects invalid explicit backend URLs instead of hiding them with a fallback", () => {
  for (const url of ["invalid", "javascript:alert(1)", "https://user:password@example.com", "https://example.com?token=x", "https://example.com#fragment", "http://example.com"]) {
    assert.ok(resolveBackendUrl({ BACKEND_API_URL: url }, { production: true }).error, url);
  }
});

function request(url, method = "GET", headers = {}) {
  return {
    url,
    method,
    headers: {
      host: "127.0.0.1:5173",
      ...headers,
    },
  };
}

describe("KnownBy development proxy guard", () => {
  test("allows same-origin browser requests and command-line tooling", () => {
    assert.equal(
      isSameOriginProxyRequest(
        request("/v1/jobs/job-1", "GET", {
          origin: "http://127.0.0.1:5173",
          "sec-fetch-site": "same-origin",
        }),
      ),
      true,
    );
    assert.equal(isSameOriginProxyRequest(request("/v1/jobs/job-1")), true);
  });

  test("rejects cross-origin and opaque browser requests", () => {
    assert.equal(
      isSameOriginProxyRequest(
        request("/v1/research/batch", "POST", {
          origin: "https://malicious.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
      false,
    );
    assert.equal(
      isSameOriginProxyRequest(
        request("/v1/research/batch", "POST", { origin: "null" }),
      ),
      false,
    );
  });

  test("only permits the required route and method pairs", () => {
    const allowed = [
      request("/v1/research/person", "POST"),
      request("/api/v1/research/batch", "POST"),
      request("/v1/jobs/job-1", "GET"),
      request("/v1/jobs/job-1/results", "GET"),
      request("/v1/jobs/job-1/export?format=csv", "GET"),
      request("/v1/jobs/job-1/cancel", "POST"),
      request("/v1/jobs/job-1/library", "POST"),
      request("/v1/library/files?limit=50&offset=0", "GET"),
      request("/v1/library/files/file-1", "GET"),
      request("/v1/library/files/file-1/records?limit=50&offset=0&q=artist", "GET"),
      request("/api/v1/library/files/file-1", "DELETE"),
    ];
    const blocked = [
      request("/v1/research/person", "GET"),
      request("/v1/jobs/job-1/cancel", "GET"),
      request("/v1/admin", "POST"),
      request("/v1/jobs/job-1/unknown", "GET"),
      request("/v1/jobs/job-1/library", "GET"),
      request("/v1/library/files", "POST"),
      request("/v1/library/files/file-1", "POST"),
      request("/v1/library/files/file-1/records", "POST"),
    ];

    assert.equal(allowed.every(isAllowedProxyRoute), true);
    assert.equal(blocked.some(isAllowedProxyRoute), false);
  });
});
