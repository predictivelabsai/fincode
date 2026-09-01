import {
  ClerkProvider,
  Show,
  SignInButton,
  UserButton,
  useAuth,
} from "@clerk/react";
import {
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import { useLocation } from "react-router-dom";

import {
  AuthenticationProvider,
  type Authentication,
} from "./auth";
import { env } from "./env";
import { isPublicRoute } from "./public-routes";

// Local/E2E-only seam: VITE_E2E_AUTH_BYPASS=1 (gitignored .env.local, never in
// deployed builds) renders the app without Clerk sign-in so visual-review tooling
// can reach authenticated pages. Same as the seam in PR #13's feat branch.
const e2eAuthBypass = import.meta.env.VITE_E2E_AUTH_BYPASS === "1";
const e2eAuthentication: Authentication = {
  getToken: async () => "e2e-auth-bypass",
};

const clerkAppearance = {
  variables: {
    colorBackground: "#0B1B14",
    colorNeutral: "#E7F5EC",
    colorPrimary: "#34D399",
    borderRadius: "8px",
    fontFamily: "Manrope Variable, sans-serif",
  },
  elements: {
    cardBox: { boxShadow: "0 18px 60px rgba(0, 0, 0, 0.42)" },
    card: { border: "1px solid #2B4B3B" },
    formFieldInput: { backgroundColor: "#06110D", borderColor: "#2B4B3B" },
    footerActionLink: { color: "#34D399" },
  },
} as const;

// Local/E2E-only seam: VITE_E2E_AUTH_BYPASS=1 (never set in deployed builds)
// renders the app without Clerk sign-in so tools like Playwright can
// screenshot authenticated pages. getToken returns a meaningless token —
// HTTP clients still issue real requests, which test tooling intercepts.
const e2eAuthBypass = import.meta.env.VITE_E2E_AUTH_BYPASS === "1";
const e2eAuthentication: Authentication = {
  getToken: async () => "e2e-auth-bypass",
};

function ClerkAuthentication({ children }: { children: ReactNode }) {
  const { getToken, isLoaded } = useAuth();
  const tokenProvider = useCallback(async () => {
    if (!isLoaded) throw new Error("Standalone authentication is still loading");
    const token = await getToken({ template: env.VITE_CLERK_JWT_TEMPLATE });
    if (!token) throw new Error("Standalone session is unavailable");
    return token;
  }, [getToken, isLoaded]);
  const value = useMemo<Authentication>(
    () => ({ getToken: tokenProvider, accountControl: <UserButton /> }),
    [tokenProvider],
  );
  return <AuthenticationProvider value={value}>{children}</AuthenticationProvider>;
}

// Public market pages stay reachable without a session: they get a nullable
// token provider plus a sign-in/user control instead of the Clerk login wall.
function PublicAuthenticationBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const value = useMemo<Authentication>(() => ({
    getToken: async () => {
      if (!isLoaded) return null;
      try {
        return await getToken({ template: env.VITE_CLERK_JWT_TEMPLATE });
      } catch {
        return null;
      }
    },
    accountControl: isSignedIn
      ? <UserButton />
      : <SignInButton mode="modal"><button className="button button-primary" type="button">Sign in</button></SignInButton>,
  }), [getToken, isLoaded, isSignedIn]);
  return <AuthenticationProvider value={value}>{children}</AuthenticationProvider>;
}

export default function StandaloneAuthentication({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (e2eAuthBypass) {
    return <AuthenticationProvider value={e2eAuthentication}>{children}</AuthenticationProvider>;
  }

  if (e2eAuthBypass) {
    return <AuthenticationProvider value={e2eAuthentication}>{children}</AuthenticationProvider>;
  }

  return (
    <ClerkProvider
      publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}
      appearance={clerkAppearance}
    >
      {isPublicRoute(location.pathname) ? (
        <PublicAuthenticationBridge>{children}</PublicAuthenticationBridge>
      ) : (
        <Show when="signed-in" fallback={signInFallback} treatPendingAsSignedOut>
          <ClerkAuthentication>{children}</ClerkAuthentication>
        </Show>
      )}
    </ClerkProvider>
  );
}

const signInFallback = (
  <main className="sign-in-shell">
    <section className="sign-in-card" aria-labelledby="sign-in-heading">
      <span className="eyebrow">PolyTrade · standalone</span>
      <h1 id="sign-in-heading">Enter the decision desk.</h1>
      <p>Sign in to research Polymarket. Connecting a wallet remains a separate step.</p>
      <SignInButton mode="modal">
        <button className="button button-primary" type="button">Sign in</button>
      </SignInButton>
    </section>
  </main>
);