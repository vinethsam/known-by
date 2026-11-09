import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBackendUrl } from "../vite.config.js";

test("resolves the same Railway fallback for local and production builds and accepts HTTPS overrides", () => {
  assert.equal(resolveBackendUrl({}), "https://known-by-backend-production.up.railway.app");
  assert.equal(resolveBackendUrl({ VITE_BACKEND_API_URL: " https://configured.example/ " }), "https://configured.example");
  assert.equal(resolveBackendUrl({
    BACKEND_API_URL: "https://canonical.example",
    VITE_BACKEND_API_URL: "https://alias.example",
  }), "https://canonical.example");
});

test("rejects explicit backend URLs that are unsafe for browser credentials", () => {
  for (const url of ["invalid", "javascript:alert(1)", "https://user:password@example.com", "https://example.com?token=x", "https://example.com#fragment", "http://example.com"]) {
    assert.throws(() => resolveBackendUrl({ BACKEND_API_URL: url }), /BACKEND_API_URL/, url);
  }
});
