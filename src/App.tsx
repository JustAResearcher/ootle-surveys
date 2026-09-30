import { useState, useEffect } from "react";
import { Admin } from "./Admin";
import { Participant } from "./Participant";
import { api } from "./api";
const fragment = new URLSearchParams(location.hash.slice(1));
const incomingAdmin = fragment.get("admin");
if (incomingAdmin) history.replaceState(null, "", location.pathname);
export default function App() {
  const [route, setRoute] = useState(
    () => new URLSearchParams(location.hash.slice(1)),
  );
  const invitation = route.get("invite"),
    secret = route.get("key");
  const [token, setToken] = useState(""),
    [access, setAccess] = useState(""),
    [tab, setTab] = useState("surveys"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function login(code: string) {
    setBusy(true);
    setError("");
    try {
      await api("/admin/session", code);
      sessionStorage.setItem("ootle-surveys-admin", code);
      setToken(code);
      setAccess("");
    } catch (e) {
      sessionStorage.removeItem("ootle-surveys-admin");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    function routeChanged() {
      const next = new URLSearchParams(location.hash.slice(1));
      const code = next.get("admin");
      if (code) {
        history.replaceState(null, "", location.pathname);
        next.delete("admin");
        void login(code);
      }
      setRoute(next);
    }
    window.addEventListener("hashchange", routeChanged);
    return () => window.removeEventListener("hashchange", routeChanged);
  }, []);
  useEffect(() => {
    if (invitation) return;
    const saved =
      incomingAdmin ?? sessionStorage.getItem("ootle-surveys-admin");
    if (saved) void login(saved);
  }, []);
  function signOut() {
    sessionStorage.removeItem("ootle-surveys-admin");
    setToken("");
    setTab("surveys");
  }
  return (
    <>
      <header className="app-header">
        <a href="/" className="brand">
          <strong>ootle</strong> surveys
        </a>
        {!invitation && token && (
          <nav aria-label="Organizer">
            <button
              className={tab === "surveys" ? "active" : ""}
              onClick={() => setTab("surveys")}
            >
              Surveys
            </button>
            <button
              className={tab === "responses" ? "active" : ""}
              onClick={() => setTab("responses")}
            >
              Responses
            </button>
          </nav>
        )}
        <div className="header-end">
          <span className="network">Esmeralda testnet</span>
          {token && !invitation && (
            <button className="text-button muted" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      {invitation ? (
        secret ? (
          <Participant
            key={invitation + secret}
            token={invitation}
            secret={secret}
          />
        ) : (
          <main className="participant">
            <h1>Incomplete invitation</h1>
            <p className="notice">
              Open the complete invitation link from your organizer, including
              its questionnaire key.
            </p>
          </main>
        )
      ) : token ? (
        <Admin
          token={token}
          tab={tab}
          setTab={setTab}
          onUnauthorized={signOut}
        />
      ) : (
        <main className="access-screen">
          <h1>
            Your questions.
            <br />
            Their privacy.
          </h1>
          <p>Create encrypted surveys and reward people for their time.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void login(access.trim());
            }}
          >
            <label htmlFor="access">Organizer access code</label>
            <input
              id="access"
              type="password"
              value={access}
              onChange={(e) => setAccess(e.target.value)}
              required
              autoComplete="current-password"
            />
            <p className="small access-help">
              Your self-hosted installation saves this code in{" "}
              <code>data/admin-access.txt</code>.
            </p>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Checking access…" : "Open organizer"}
            </button>
          </form>
        </main>
      )}
      <footer className="app-footer">
        Your questions and answers stay off-chain.
      </footer>
    </>
  );
}
