import { Component, useEffect, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import "./startup.css";

class OrbBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <span className="startup-orb-fallback" aria-hidden="true" />
      : this.props.children;
  }
}

/**
 * Mount once beside the existing AnimatedBackground and the app interface.
 * Reveal the interface in onReveal, keeping it inert until onComplete. The
 * startup is bounded and does not depend on a network, font, or OAuth response.
 */
export default function StartupSequence({ onReveal, onComplete }) {
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const callbacks = useRef({ onReveal, onComplete });
  callbacks.current = { onReveal, onComplete };

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", updatePreference);

    const revealAfter = preference.matches ? 250 : 800;
    const fadeDuration = preference.matches ? 100 : 200;
    const revealTimer = window.setTimeout(() => {
      setLeaving(true);
      callbacks.current.onReveal?.();
    }, revealAfter);
    const completeTimer = window.setTimeout(() => {
      setDone(true);
      callbacks.current.onComplete?.();
    }, revealAfter + fadeDuration);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(completeTimer);
      preference.removeEventListener("change", updatePreference);
    };
  }, []);

  if (done) return null;

  return (
    <div
      className={`startup-sequence${leaving ? " startup-sequence--leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="startup-card">
        <span className="logo-crop startup-logo" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}KB_dark-text.svg`} alt="" />
        </span>
        <div className="startup-status">
          <span className="startup-orb" aria-hidden="true">
            <OrbBoundary>
              {/* Thinking Orbs defines presets only for 20, 32, and 64px. */}
              <ThinkingOrb
                state="composing"
                size={20}
                theme="dark"
                color="#a2adff"
                paused={reducedMotion || leaving}
                aria-hidden="true"
              />
            </OrbBoundary>
          </span>
          <span>Starting KnownBy</span>
        </div>
      </div>
    </div>
  );
}
