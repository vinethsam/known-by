import { Component, useCallback, useEffect, useRef, useState } from "react";
import "./animated-background.css";

function canUseWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class ShaderErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** One decorative canvas for the entire app, with an always-available CSS background. */
export default function AnimatedBackground() {
  const surfaceRef = useRef(null);
  const [canAnimate, setCanAnimate] = useState(false);
  const [shaderModule, setShaderModule] = useState(null);
  const [failed, setFailed] = useState(false);
  const handleFailure = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const smallScreen = window.matchMedia("(max-width: 720px)");
    const lowPower =
      navigator.connection?.saveData === true ||
      (typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4) ||
      (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2);

    const update = () => {
      setCanAnimate(
        !reducedMotion.matches &&
          !smallScreen.matches &&
          !lowPower &&
          document.visibilityState === "visible",
      );
    };

    update();
    reducedMotion.addEventListener("change", update);
    smallScreen.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      reducedMotion.removeEventListener("change", update);
      smallScreen.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!canAnimate || shaderModule || failed) return undefined;

    let cancelled = false;
    let idleId;
    let timeoutId;

    const loadShader = async () => {
      if (!canUseWebGL()) {
        if (!cancelled) setFailed(true);
        return;
      }

      try {
        const module = await import("@shadergradient/react");
        if (!cancelled) setShaderModule(module);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    if ("requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(loadShader, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(loadShader, 250);
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [canAnimate, shaderModule, failed]);

  useEffect(() => {
    if (!shaderModule || !canAnimate || failed) return undefined;
    const surface = surfaceRef.current;
    const onContextLost = (event) => {
      event.preventDefault();
      // R3F intentionally loses its context while unmounting for a hidden tab
      // or a lower-power mode. Let the normal eligibility check restore it.
      if (
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia("(max-width: 720px)").matches
      ) return;
      setFailed(true);
    };
    surface?.addEventListener("webglcontextlost", onContextLost, true);
    return () => surface?.removeEventListener("webglcontextlost", onContextLost, true);
  }, [shaderModule, canAnimate, failed]);

  const showShader = Boolean(canAnimate && shaderModule && !failed);
  const ShaderGradientCanvas = shaderModule?.ShaderGradientCanvas;
  const ShaderGradient = shaderModule?.ShaderGradient;

  return (
    <div
      ref={surfaceRef}
      className="knownby-background"
      data-gradient-state={showShader ? "animated" : "static"}
      aria-hidden="true"
    >
      {showShader && (
        <ShaderErrorBoundary onFailure={handleFailure}>
          <div className="knownby-background__shader">
            <ShaderGradientCanvas
              style={{ position: "absolute", inset: 0 }}
              pixelDensity={1}
              lazyLoad
              threshold={0}
              pointerEvents="none"
              powerPreference="low-power"
            >
              <ShaderGradient
                control="props"
                type="plane"
                shader="defaults"
                animate="on"
                uSpeed={0.12}
                uStrength={2}
                uDensity={1.3}
                uFrequency={5.5}
                color1="#1c1f2e"
                color2="#4457d9"
                color3="#a2adff"
                brightness={0.7}
                lightType="3d"
                grain="off"
                reflection={0.1}
                enableTransition={false}
                enableCameraUpdate={false}
                toggleAxis={false}
              />
            </ShaderGradientCanvas>
          </div>
        </ShaderErrorBoundary>
      )}
    </div>
  );
}
