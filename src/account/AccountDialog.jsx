import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, LockKeyhole, UserRound, X } from "lucide-react";
import { useGlassSurface } from "../glass/useGlassSurface.js";
import { authenticateGoogle, browserSignInRequired, formatApiError, getAuthConfig, getSignedInUser, signOut, subscribeToAccount } from "../api.js";
import { renderGoogleSignIn } from "./googleIdentity.js";
import "./account.css";

export default function AccountDialog({ onClose }) {
  const dialogRef = useRef(null);
  const googleButton = useRef(null);
  const backdropPointerDown = useRef(false);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const user = useSyncExternalStore(subscribeToAccount, getSignedInUser);
  const developmentConnection = !browserSignInRequired();
  const titleId = useId();
  const descriptionId = useId();
  const availabilityId = useId();

  useGlassSurface(dialogRef, { surfaceOpacity: 0.34, borderRadius: 18 });

  useEffect(() => {
    if (user || developmentConnection) return undefined;
    let stopped = false;
    let removeButton;
    const controller = new AbortController();
    setLoading(true);
    setVerifying(false);
    setError("");
    (async () => {
      try {
        const config = await getAuthConfig({ signal: controller.signal });
        if (stopped) return;
        if (!config.enabled || !config.google_client_id) {
          throw new Error("Google sign-in is not configured. Please contact the KnownBy administrator.");
        }
        removeButton = await renderGoogleSignIn(googleButton.current, config.google_client_id, async (credential) => {
          if (stopped) return;
          setVerifying(true);
          setError("");
          try {
            await authenticateGoogle(credential);
          } catch (failure) {
            if (!stopped) setError(formatApiError(failure));
          } finally {
            if (!stopped) setVerifying(false);
          }
        });
        if (stopped) removeButton();
      } catch (failure) {
        if (!stopped) setError(formatApiError(failure));
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      removeButton?.();
    };
  }, [user, developmentConnection]);

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
      data-auth-state={user ? "signed-in" : "signed-out"}
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

      <div className="account-state"><UserRound size={13} /> {user ? "Signed in" : developmentConnection ? "Development" : "Signed out"}</div>
      <h2 id={titleId}>Your KnownBy account</h2>
      <p id={descriptionId} className="account-description">
        {user ? user.email : developmentConnection ? "Local development connection" : "Sign in with your approved Google account."}
      </p>

      <div className="account-provider">
        {user ? (
          <button className="account-google" type="button" onClick={signOut}>Sign out</button>
        ) : !developmentConnection && (
          <div ref={googleButton} className="account-google-button" aria-busy={loading || verifying} />
        )}
        <p id={availabilityId} className="account-availability" role={error ? "alert" : "status"}>
          <LockKeyhole size={13} aria-hidden="true" />
          {error || (developmentConnection ? "This session uses the configured development connection." :
            verifying ? "Verifying your account…" : loading && !user ? "Loading Google sign-in…" :
            user ? "Access verified by KnownBy." : "Only approved accounts can access research and saved results.")}
        </p>
      </div>

      <div className="account-dialog-footer">
        <p>{user || developmentConnection ? "You can continue to KnownBy." : "Sign in to research people and open the Database."}</p>
        <button className="account-continue" type="button" onClick={() => setClosing(true)}>
          Continue to KnownBy <ArrowRight size={15} />
        </button>
      </div>
    </dialog>
  );
}
