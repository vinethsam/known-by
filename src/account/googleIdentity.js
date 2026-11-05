let libraryPromise;
let initializedClient;
let credentialCallback;

function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.id) return Promise.resolve(globalThis.google.accounts.id);
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      libraryPromise = null;
      reject(new Error("Could not load Google sign-in. Check your connection and try again."));
    };
    const timer = setTimeout(fail, 15_000);
    script.onload = () => {
      clearTimeout(timer);
      if (globalThis.google?.accounts?.id) resolve(globalThis.google.accounts.id);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return libraryPromise;
}

export async function renderGoogleSignIn(container, clientId, callback) {
  const identity = await loadGoogleIdentity();
  if (!container?.isConnected) return () => {};
  credentialCallback = callback;
  if (initializedClient !== clientId) {
    identity.initialize({
      client_id: clientId,
      callback: (response) => credentialCallback?.(response.credential),
      auto_select: false,
      ux_mode: "popup",
    });
    initializedClient = clientId;
  }
  identity.renderButton(container, {
    type: "standard", theme: "outline", size: "large", text: "continue_with",
    shape: "rectangular", width: Math.min(400, Math.floor(container.clientWidth)),
  });
  return () => {
    if (credentialCallback === callback) credentialCallback = null;
    container.replaceChildren();
  };
}
