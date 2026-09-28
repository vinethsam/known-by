import { useEffect, useRef, useState } from "react";
import { createLiquidGlassRenderer } from "./liquidGlassRenderer.js";
import "./glass.css";

// A small texture of KnownBy's existing background is shared by all surfaces.
// Sampling only this decorative layer prevents old tabs, logos, and result text
// from ever appearing inside the refracted glass.
const surfaces = new Set();
let backgroundSnapshot = null;
let captureTimer = null;
let captureVersion = 0;

function scheduleCapture() {
  if (!surfaces.size) return;
  if (captureTimer !== null) clearTimeout(captureTimer);
  captureTimer = window.setTimeout(captureBackground, 250);
}

function cssColor(input, alpha = 1) {
  const channels = colorToRgb(input, [0.11, 0.12, 0.18]);
  return `rgba(${channels.map((channel) => Math.round(channel * 255)).join(",")},${alpha})`;
}

function captureBackground() {
  captureTimer = null;
  if (!surfaces.size) return;
  try {
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    const scale = Math.min(1, 1024 / Math.max(viewportWidth, viewportHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewportWidth * scale);
    canvas.height = Math.ceil(viewportHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Background canvas unavailable");

    const style = getComputedStyle(document.documentElement);
    const navy = style.getPropertyValue("--navy").trim() || "#1c1f2e";
    const input = style.getPropertyValue("--input").trim() || "#1c2032";
    const panel = style.getPropertyValue("--panel").trim() || "#24283b";
    const blue = style.getPropertyValue("--blue").trim() || "#4457d9";
    const accent = style.getPropertyValue("--accent").trim() || "#a2adff";
    const width = canvas.width;
    const height = canvas.height;

    // Match .knownby-background's existing navy base and two soft glows.
    const base = context.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, input);
    base.addColorStop(0.62, navy);
    base.addColorStop(1, panel);
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    const addGlow = (centerX, centerY, radiusX, radiusY, color, opacity) => {
      context.save();
      context.translate(centerX, centerY);
      context.scale(radiusX, radiusY);
      const glow = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, cssColor(color, opacity));
      glow.addColorStop(1, cssColor(color, 0));
      context.fillStyle = glow;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    };
    addGlow(width * 0.78, height * 0.18, width * 0.48, height * 0.48, blue, 0.31);
    addGlow(width * 0.12, height * 0.78, width * 0.44, height * 0.44, accent, 0.15);

    const shade = context.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, cssColor(navy, 0.15));
    shade.addColorStop(0.28, cssColor(navy, 0));
    shade.addColorStop(1, cssColor(navy, 0.25));
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);

    backgroundSnapshot = { canvas, scale, fixed: true, version: ++captureVersion };
    for (const surface of surfaces) surface.setSnapshot(backgroundSnapshot);
  } catch {
    // Retain the CSS glass layer if Canvas 2D is unavailable.
    for (const surface of surfaces) surface.captureFailed();
  }
}

function subscribe(surface) {
  surfaces.add(surface);
  if (backgroundSnapshot) surface.setSnapshot(backgroundSnapshot);
  scheduleCapture();
  return () => {
    surfaces.delete(surface);
    if (!surfaces.size) {
      if (captureTimer !== null) clearTimeout(captureTimer);
      captureTimer = null;
      backgroundSnapshot = null;
    }
  };
}

function colorToRgb(input, fallback) {
  if (Array.isArray(input) && input.length === 3) {
    return input.map((channel) => Math.max(0, Math.min(1, Number(channel) || 0)));
  }
  const value = String(input || "").trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length === 3
      ? [...hex[1]].map((digit) => digit + digit).join("")
      : hex[1].slice(0, 6);
    return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255);
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return rgb.slice(1, 4).map((channel) => Math.min(255, Number(channel)) / 255);
  return fallback;
}

function canUseWebGLGlass() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return window.innerWidth > 720
    && !document.hidden
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    && !connection?.saveData
    && !["slow-2g", "2g"].includes(connection?.effectiveType)
    && !(navigator.deviceMemory && navigator.deviceMemory <= 2)
    && !(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
}

function resolvedOptions(host, options) {
  const style = getComputedStyle(host);
  return {
    borderRadius: Math.max(0, Number(options.borderRadius ?? parseFloat(style.borderTopLeftRadius)) || 0),
    blurRadius: Math.max(0.25, Math.min(8, Number(options.blurRadius ?? 1.4) || 1.4)),
    edgeIntensity: Math.max(0, Math.min(0.1, Number(options.edgeIntensity ?? 0.012))),
    rimIntensity: Math.max(0, Math.min(0.2, Number(options.rimIntensity ?? 0.028))),
    tintOpacity: Math.max(0, Math.min(1, Number(options.tintOpacity ?? 0.24))),
    surfaceOpacity: Math.max(0, Math.min(0.75, Number(options.surfaceOpacity ?? 0.42))),
    tintColor: colorToRgb(options.tintColor ?? style.getPropertyValue("--panel"), [0.14, 0.16, 0.23]),
    accentColor: colorToRgb(options.accentColor ?? style.getPropertyValue("--accent"), [0.64, 0.68, 1]),
  };
}

/**
 * Attach the adapted Liquid Glass renderer to an existing React element.
 * React retains ownership of all children; only a pointer-inert canvas is
 * inserted behind them. `refreshKey` regenerates the decorative background
 * texture when its theme changes; ordinary content changes need no recapture.
 *
 * @param {import('react').RefObject<HTMLElement>} ref
 * @param {{ enabled?: boolean, refreshKey?: unknown, borderRadius?: number,
 *   blurRadius?: number, edgeIntensity?: number, rimIntensity?: number,
 *   tintOpacity?: number, surfaceOpacity?: number, tintColor?: string,
 *   accentColor?: string }} options
 */
export function useGlassSurface(ref, options = {}) {
  const { enabled = true, refreshKey, ...effectOptions } = options;
  const optionsRef = useRef(effectOptions);
  const surfaceRef = useRef(null);
  const [runtimeAllowed, setRuntimeAllowed] = useState(canUseWebGLGlass);
  optionsRef.current = effectOptions;

  useEffect(() => {
    const update = () => setRuntimeAllowed(canUseWebGLGlass());
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    window.addEventListener("resize", update, { passive: true });
    document.addEventListener("visibilitychange", update);
    reducedMotion?.addEventListener?.("change", update);
    connection?.addEventListener?.("change", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", update);
      reducedMotion?.removeEventListener?.("change", update);
      connection?.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    const host = enabled ? ref.current : null;
    const mode = runtimeAllowed ? "webgl" : "fallback";
    if (surfaceRef.current?.host === host && surfaceRef.current?.mode === mode) return;
    surfaceRef.current?.cleanup();
    if (!host || typeof window === "undefined") return;

    const hadClass = host.classList.contains("kb-glass-host");
    const previousPosition = host.style.position;
    const previousData = host.getAttribute("data-kb-glass-surface");
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.classList.add("kb-glass-host");
    host.setAttribute("data-kb-glass-surface", "");
    const restoreHost = () => {
      host.removeAttribute("data-kb-glass-ready");
      if (!hadClass) host.classList.remove("kb-glass-host");
      host.style.position = previousPosition;
      if (previousData === null) host.removeAttribute("data-kb-glass-surface");
      else host.setAttribute("data-kb-glass-surface", previousData);
    };
    const useFallback = () => {
      const fallback = {
        host,
        mode,
        cleanup: () => {
          restoreHost();
          if (surfaceRef.current === fallback) surfaceRef.current = null;
        },
      };
      surfaceRef.current = fallback;
    };
    if (mode === "fallback") {
      useFallback();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "kb-liquid-glass-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.insertBefore(canvas, host.firstChild);

    const renderer = createLiquidGlassRenderer(canvas);
    if (!renderer) {
      canvas.remove();
      useFallback();
      return;
    }

    let active = true;
    let visible = true;
    let contextLost = false;
    let frame = null;
    const requestDraw = () => {
      if (!active || !visible || contextLost || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!active || !visible || contextLost) return;
        const drawn = renderer.draw(host, resolvedOptions(host, optionsRef.current));
        if (drawn) host.setAttribute("data-kb-glass-ready", "true");
        else host.removeAttribute("data-kb-glass-ready");
      });
    };
    const surface = {
      host,
      mode,
      setSnapshot(snapshot) {
        if (!active) return;
        renderer.setSnapshot(snapshot);
        requestDraw();
      },
      captureFailed() {
        if (!active) return;
        renderer.setSnapshot(null);
        host.removeAttribute("data-kb-glass-ready");
      },
      requestDraw,
    };
    surfaceRef.current = surface;
    const unsubscribe = subscribe(surface);
    let observedWidth = 0;
    let observedHeight = 0;
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
        const { width, height } = entries[0]?.contentRect || {};
        if (Math.abs(width - observedWidth) > 1 || Math.abs(height - observedHeight) > 1) {
          observedWidth = width;
          observedHeight = height;
          scheduleCapture();
        }
        requestDraw();
      }) : null;
    resizeObserver?.observe(host);
    const intersectionObserver = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) requestDraw();
      }) : null;
    intersectionObserver?.observe(host);

    const onResize = () => { scheduleCapture(); requestDraw(); };
    const onContextLost = (event) => {
      event.preventDefault();
      contextLost = true;
      host.removeAttribute("data-kb-glass-ready");
      canvas.style.display = "none";
    };
    window.addEventListener("scroll", requestDraw, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    canvas.addEventListener("webglcontextlost", onContextLost);

    surface.cleanup = () => {
      active = false;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestDraw);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      unsubscribe();
      renderer.destroy();
      canvas.remove();
      if (surfaceRef.current === surface) surfaceRef.current = null;
      restoreHost();
    };
  });

  useEffect(() => () => surfaceRef.current?.cleanup(), []);

  useEffect(() => {
    if (enabled && runtimeAllowed && surfaceRef.current?.mode === "webgl") scheduleCapture();
  }, [enabled, runtimeAllowed, refreshKey]);

  useEffect(() => {
    surfaceRef.current?.requestDraw?.();
  }, [
    effectOptions.borderRadius,
    effectOptions.blurRadius,
    effectOptions.edgeIntensity,
    effectOptions.rimIntensity,
    effectOptions.tintOpacity,
    effectOptions.surfaceOpacity,
    effectOptions.tintColor,
    effectOptions.accentColor,
  ]);
}
