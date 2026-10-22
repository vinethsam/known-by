import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, LockKeyhole, UserRound, X } from "lucide-react";
import { useGlassSurface } from "../glass/useGlassSurface.js";
import "./account.css";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36ZM12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.59A10 10 0 0 0 12 22ZM6.4 13.92A6 6 0 0 1 6.09 12c0-.67.11-1.32.31-1.92V7.49H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.51l3.35-2.59ZM12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.35 2.59C7.19 7.72 9.4 5.96 12 5.96Z"
      />
    </svg>
  );
}

/** Signed-out entry point. Google authentication can be connected here later. */
export default function AccountDialog({ onClose }) {
  const dialogRef = useRef(null);
  const backdropPointerDown = useRef(false);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const availabilityId = useId();

  useGlassSurface(dialogRef, { surfaceOpacity: 0.34, borderRadius: 18 });

  useEffect(() => {
    const panel = dialogRef.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    panel.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      if (panel.open) panel.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!closing) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onClose, reducedMotion ? 0 : 160);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);

  function isBackdrop(event) {
    if (event.target !== event.currentTarget) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  }

  return (
    <dialog
      ref={dialogRef}
      className="account-dialog"
      data-auth-state="signed-out"
      data-closing={closing || undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        setClosing(true);
      }}
      onPointerDown={(event) => { backdropPointerDown.current = isBackdrop(event); }}
      onClick={(event) => {
        if (backdropPointerDown.current && isBackdrop(event)) setClosing(true);
        backdropPointerDown.current = false;
      }}
    >
      <div className="account-dialog-top">
        <span className="logo-crop">
          <img src={`${import.meta.env.BASE_URL}KB_dark-text.svg`} alt="KnownBy" />
        </span>
        <button
          className="account-close"
          type="button"
          aria-label="Close account"
          autoFocus
          onClick={() => setClosing(true)}
        >
          <X size={18} />
        </button>
      </div>

      <div className="account-state"><UserRound size={13} /> Signed out</div>
      <h2 id={titleId}>Your KnownBy account</h2>
      <p id={descriptionId} className="account-description">
        Google sign-in is coming to KnownBy.
      </p>

      <div className="account-provider">
        <button
          className="account-google"
          type="button"
          disabled
          aria-describedby={availabilityId}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <p id={availabilityId} className="account-availability">
          <LockKeyhole size={13} />
          Google sign-in is not available yet.
        </p>
      </div>

      <div className="account-dialog-footer">
        <p>You can continue using KnownBy without signing in.</p>
        <button className="account-continue" type="button" onClick={() => setClosing(true)}>
          Continue to KnownBy <ArrowRight size={15} />
        </button>
      </div>
    </dialog>
  );
}
