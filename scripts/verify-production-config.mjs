import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import configure from "../vite.config.js";

const expectedBackend = process.argv[2];
assert.ok(expectedBackend, "Pass the expected public production backend URL");
const expectedRoot = `${new URL(expectedBackend).href.replace(/\/+$/, "")}/v1`;
const config = configure({ mode: "production", command: "build" });
const apiRoot = JSON.parse(config.define.__KNOWNBY_API_ROOT__);
assert.equal(apiRoot, expectedRoot, "Resolved production backend differs from the required destination");
const preview = configure({ mode: "production", command: "serve", isPreview: true });
const development = configure({ mode: "development", command: "serve" });
for (const environment of [config, preview, development]) {
  assert.equal(environment.define.__KNOWNBY_API_ROOT__, JSON.stringify(expectedRoot));
  assert.equal(environment.define.__KNOWNBY_DEVELOPMENT_PROXY__, undefined, "Google sign-in must not have a proxy bypass");
  assert.equal(environment.server?.proxy, undefined, "Browser requests must use the direct HTTPS API");
}
assert.equal(development.server.host, "localhost");
assert.equal(development.server.port, 5173);
assert.equal(development.server.strictPort, true);
assert.equal(development.server.headers["Referrer-Policy"], "no-referrer-when-downgrade");

// Inspect the actual entry shipped to Pages, rather than accepting build success.
const html = await readFile("dist/index.html", "utf8");
const entry = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)[1];
const bundle = await readFile(join("dist", entry.replace(config.base, "")), "utf8");
assert.ok(bundle.includes(expectedRoot), "Production entry does not contain the resolved API root");
assert.doesNotMatch(bundle, /__KNOWNBY_API_ROOT__|__KNOWNBY_DEVELOPMENT_PROXY__|(["'`])\/api\/v1\1/,
  "Production entry still uses an unresolved or development-only API root");
assert.doesNotMatch(bundle, /BACKEND_API_TOKEN|API_ACCESS_TOKEN|LIBRARY_DELETE_TOKEN|OPENROUTER_API_KEY|GOOGLE_CLIENT_SECRET/,
  "Server-only token configuration entered the bundle");
assert.ok(bundle.includes("https://accounts.google.com/gsi/client"), "Production entry is missing Google sign-in");

// Exercise both submission paths with fetch completely mocked: never start research.
globalThis.__KNOWNBY_API_ROOT__ = apiRoot;
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  const payload = new URL(url).pathname.endsWith("/library/files")
    ? [] : { job_id: "configuration-check", status: "queued", total_people: 1 };
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
};
const api = await import("../src/api.js?production-configuration-check");
await api.researchPerson({ full_name: "Configuration Check" });
await api.researchBatch(new File(["name\nConfiguration Check\n"], "check.csv"));
await api.listLibraryFiles();
assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), [
  "/v1/research/person", "/v1/research/batch", "/v1/library/files",
]);
for (const { url, options } of requests) {
  assert.ok(url.startsWith(`${expectedRoot}/`));
  assert.equal(new Headers(options.headers).has("Authorization"), false);
}
// Also verify the production destination carries a verified user's credential,
// rather than requiring a server-held key in the static frontend.
requests.length = 0;
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  const payload = new URL(url).pathname.endsWith("/auth/me")
    ? { authentication: "google", email: "configuration@example.test", subject: "configuration-user",
        expires_at: Math.floor(Date.now() / 1000) + 3600, can_delete: false }
    : [];
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
};
await api.authenticateGoogle("mock-per-user-credential");
await api.listLibraryFiles();
assert.deepEqual(requests.map(({ url }) => new URL(url).pathname), ["/v1/auth/me", "/v1/library/files"]);
for (const { url, options } of requests) {
  assert.ok(url.startsWith(`${expectedRoot}/`));
  assert.equal(new Headers(options.headers).get("Authorization"), "Bearer mock-per-user-credential");
}
api.signOut();
console.log(`Verified production bundle and mocked API destinations: ${apiRoot}`);
