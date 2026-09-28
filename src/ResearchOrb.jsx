import { ThinkingOrb } from "thinking-orbs";
import "./ResearchOrb.css";

/** Inline research activity indicator. Adjacent status text supplies the name by default. */
export default function ResearchOrb({
  className = "",
  decorative = true,
  label = "Research in progress",
  paused = false,
  compact = false,
}) {
  return (
    <span className={`research-orb ${compact ? "research-orb-compact" : ""} ${className}`.trim()}>
      <ThinkingOrb
        state="composing"
        size={20}
        theme="dark"
        paused={paused}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : label}
      />
    </span>
  );
}
