import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const URL_PLACEHOLDER = "PASTE_RAILWAY_BACKEND_URL_HERE";
const TOKEN_PLACEHOLDER = "PASTE_RAILWAY_API_ACCESS_TOKEN_HERE";
const PRODUCTION_BACKEND_URL = "https://known-by-backend-production.up.railway.app";
const API_ROUTES = [
  ["POST", /^\/v1\/research\/(?:person|batch)$/],
  ["GET", /^\/v1\/jobs\/[^/]+$/],
  ["GET", /^\/v1\/jobs\/[^/]+\/(?:results|export)$/],
  ["POST", /^\/v1\/jobs\/[^/]+\/cancel$/],
  ["POST", /^\/v1\/jobs\/[^/]+\/library$/],
  ["GET", /^\/v1\/library\/files$/],
  ["GET", /^\/v1\/library\/files\/[^/]+$/],
  ["GET", /^\/v1\/library\/files\/[^/]+\/records$/],
  ["DELETE", /^\/v1\/library\/files\/[^/]+$/],
];

function headerValue(request, name) {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

export function isSameOriginProxyRequest(request) {
  const fetchSite = headerValue(request, "sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = headerValue(request, "origin");
  if (!origin) return true;
  if (!request.headers?.host || origin === "null") return false;

  try {
    const parsedOrigin = new URL(origin);
    return (
      (parsedOrigin.protocol === "http:" ||
        parsedOrigin.protocol === "https:") &&
      parsedOrigin.host === request.headers.host
    );
  } catch {
    return false;
  }
}

export function isAllowedProxyRoute(request) {
  let pathname;
  try {
    pathname = new URL(request.url || "/", "http://localhost").pathname;
  } catch {
    return false;
  }
  const backendPath = pathname.replace(/^\/api(?=\/|$)/, "");
  return API_ROUTES.some(
    ([method, pattern]) =>
      request.method === method && pattern.test(backendPath),
  );
}

export function resolveBackendUrl(environment, { production = false } = {}) {
  // BACKEND_API_URL remains the canonical override; accept the existing VITE_
  // alias too. Only the public URL is ever compiled into the browser bundle.
  const configured = [environment.BACKEND_API_URL, environment.VITE_BACKEND_API_URL]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .find((value) => value && value !== URL_PLACEHOLDER);
  const backendUrl = configured || (production ? PRODUCTION_BACKEND_URL : "");

  if (!backendUrl || backendUrl === URL_PLACEHOLDER) {
    return { error: "BACKEND_API_URL is not configured" };
  }

  let target;
  try {
    target = new URL(backendUrl);
  } catch {
    return { error: "BACKEND_API_URL is invalid" };
  }

  if (!/^https?:$/.test(target.protocol)) {
    return { error: "BACKEND_API_URL must use http or https" };
  }

  if (target.username || target.password || target.search || target.hash) {
    return { error: "BACKEND_API_URL must not include credentials, a query or a fragment" };
  }

  if (production && target.protocol !== "https:") {
    return { error: "BACKEND_API_URL must use https for production" };
  }

  return { target: target.toString().replace(/\/+$/, "") };
}

function readProxyConfiguration(environment, backend) {
  if (backend.error) return backend;
  const backendToken = environment.BACKEND_API_TOKEN?.trim() ?? "";

  if (!backendToken || backendToken === TOKEN_PLACEHOLDER) {
    return { error: "BACKEND_API_TOKEN is not configured" };
  }

  return {
    target: backend.target,
    token: backendToken,
  };
}

function sendProxyError(response, statusCode, detail, code) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ detail, code }));
}

function proxyRequestGuard(configurationError) {
  return {
    name: "knownby-proxy-request-guard",
    configureServer(server) {
      server.middlewares.use("/api", (request, response, next) => {
        if (!isSameOriginProxyRequest(request)) {
          sendProxyError(
            response,
            403,
            "Cross-origin API proxy requests are not allowed",
            "CROSS_ORIGIN_PROXY_REQUEST",
          );
          return;
        }

        if (!isAllowedProxyRoute(request)) {
          sendProxyError(
            response,
            404,
            "This API proxy route is not available",
            "PROXY_ROUTE_NOT_ALLOWED",
          );
          return;
        }

        if (configurationError) {
          sendProxyError(
            response,
            503,
            configurationError,
            "VITE_PROXY_NOT_CONFIGURED",
          );
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // loadEnv with an empty prefix stays server-side. Explicitly expose just one
  // public API root; the development proxy token never enters define/envPrefix.
  const environment = loadEnv(mode, process.cwd(), "");
  const production = command === "build";
  const backend = resolveBackendUrl(environment, { production });
  if (production && backend.error) throw new Error(backend.error);
  const proxyConfiguration = readProxyConfiguration(environment, backend);
  const proxy = proxyConfiguration.error
    ? undefined
    : {
        "/api": {
          target: proxyConfiguration.target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ""),
          configure(proxyServer) {
            proxyServer.on("proxyReq", (proxyRequest) => {
              // Never trust or forward browser-supplied credentials.
              proxyRequest.removeHeader("authorization");
              proxyRequest.setHeader(
                "Authorization",
                `Bearer ${proxyConfiguration.token}`,
              );
            });
            proxyServer.on("error", (_error, _request, response) => {
              if (
                !response ||
                typeof response.writeHead !== "function" ||
                response.headersSent
              ) {
                return;
              }

              response.writeHead(502, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
              });
              response.end(
                JSON.stringify({
                  detail: "The backend research service is unavailable",
                  code: "BACKEND_UNAVAILABLE",
                }),
              );
            });
          },
        },
      };

  return {
    base: "/known-by/",
    define: {
      __KNOWNBY_API_ROOT__: JSON.stringify(production ? `${backend.target}/v1` : "/api/v1"),
    },
    plugins: [react(), proxyRequestGuard(proxyConfiguration.error)],
    server: proxy ? { proxy } : undefined,
  };
});
