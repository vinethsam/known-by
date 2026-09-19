import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const URL_PLACEHOLDER = "PASTE_RAILWAY_BACKEND_URL_HERE";
const TOKEN_PLACEHOLDER = "PASTE_RAILWAY_API_ACCESS_TOKEN_HERE";
const API_ROUTES = [
  ["POST", /^\/v1\/research\/(?:person|batch)$/],
  ["GET", /^\/v1\/jobs\/[^/]+$/],
  ["GET", /^\/v1\/jobs\/[^/]+\/(?:results|export)$/],
  ["POST", /^\/v1\/jobs\/[^/]+\/cancel$/],
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

function readProxyConfiguration(mode) {
  // An empty prefix is intentional: these values stay in this server-side
  // configuration file and are never exposed through import.meta.env.
  const environment = loadEnv(mode, process.cwd(), "");
  const backendUrl = environment.BACKEND_API_URL?.trim() ?? "";
  const backendToken = environment.BACKEND_API_TOKEN?.trim() ?? "";

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

  if (!backendToken || backendToken === TOKEN_PLACEHOLDER) {
    return { error: "BACKEND_API_TOKEN is not configured" };
  }

  return {
    target: target.toString().replace(/\/$/, ""),
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

export default defineConfig(({ mode }) => {
  const proxyConfiguration = readProxyConfiguration(mode);
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
    plugins: [react(), proxyRequestGuard(proxyConfiguration.error)],
    server: proxy ? { proxy } : undefined,
  };
});
