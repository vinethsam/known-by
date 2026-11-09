import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND_URL = "https://known-by-backend-production.up.railway.app";

export function resolveBackendUrl(environment) {
  // Only the public URL is ever compiled into the browser bundle.
  const configured = [environment.BACKEND_API_URL, environment.VITE_BACKEND_API_URL]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find((value) => value && value !== "PASTE_RAILWAY_BACKEND_URL_HERE");

  let target;
  try {
    target = new URL(configured || BACKEND_URL);
  } catch {
    throw new Error("BACKEND_API_URL is invalid");
  }

  if (target.protocol !== "https:") {
    throw new Error("BACKEND_API_URL must use https for Google sign-in");
  }

  if (target.username || target.password || target.search || target.hash) {
    throw new Error("BACKEND_API_URL must not include credentials, a query or a fragment");
  }

  return target.toString().replace(/\/+$/, "");
}

export default defineConfig(({ mode, command, isPreview }) => {
  const backend = resolveBackendUrl(loadEnv(mode, process.cwd(), ""));
  return {
    base: "/known-by/",
    define: { __KNOWNBY_API_ROOT__: JSON.stringify(`${backend}/v1`) },
    plugins: [react()],
    server: command === "serve" && isPreview !== true ? {
      host: "localhost",
      port: 5173,
      strictPort: true,
      headers: { "Referrer-Policy": "no-referrer-when-downgrade" },
    } : undefined,
  };
});
