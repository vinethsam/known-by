import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isAllowedProxyRoute,
  isSameOriginProxyRequest,
} from "../vite.config.js";

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
    ];
    const blocked = [
      request("/v1/research/person", "GET"),
      request("/v1/jobs/job-1/cancel", "GET"),
      request("/v1/admin", "POST"),
      request("/v1/jobs/job-1/unknown", "GET"),
    ];

    assert.equal(allowed.every(isAllowedProxyRoute), true);
    assert.equal(blocked.some(isAllowedProxyRoute), false);
  });
});
