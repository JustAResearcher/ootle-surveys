import { useState } from "react";
import { Admin } from "./Admin";
import { Participant } from "./Participant";
const fragment = new URLSearchParams(location.hash.slice(1));
const invitation = fragment.get("invite"),
  secret = fragment.get("key");
if (fragment.get("admin")) {
  sessionStorage.setItem("ootle-surveys-admin", fragment.get("admin")!);
  history.replaceState(null, "", location.pathname);
}
export default function App() {
  const [token, setToken] = useState(
      sessionStorage.getItem("ootle-surveys-admin") ?? "",
    ),
    [access, setAccess] = useState(""),
    [tab, setTab] = useState("surveys");
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
        <span className="network">Esmeralda testnet</span>
      </header>
      {invitation && secret ? (
        <Participant token={invitation} secret={secret} />
      ) : token ? (
        <Admin token={token} tab={tab} setTab={setTab} />
      ) : (
        <main className="access-screen">
          <h1>
            Your questions.
            <br />
            Their privacy.
          </h1>
          <p>
            Open your organizer access link to create surveys and review
            responses.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sessionStorage.setItem("ootle-surveys-admin", access.trim());
              setToken(access.trim());
            }}
          >
            <label htmlFor="access">Organizer access code</label>
            <input
              id="access"
              type="password"
              value={access}
              onChange={(e) => setAccess(e.target.value)}
              required
            />
            <button className="primary">Open organizer</button>
          </form>
        </main>
      )}
      <footer className="app-footer">
        Your questions and answers stay off-chain.
      </footer>
    </>
  );
}
