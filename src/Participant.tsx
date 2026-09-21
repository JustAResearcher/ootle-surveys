import { useEffect, useState } from "react";
import { open } from "../lib/survey-crypto";
import { encryptResponse } from "../lib/envelopes.mjs";
import { api, type Questionnaire } from "./api";
export function Participant({
  token,
  secret,
}: {
  token: string;
  secret: string;
}) {
  const [invitation, setInvitation] = useState<any>(null),
    [survey, setSurvey] = useState<Questionnaire | null>(null),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [destination, setDestination] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const i = await api("/invitation", token);
        const q = await open(
          secret,
          i.questions,
          "ootle-surveys/questions/" + i.surveyId,
        );
        if (active) {
          setInvitation(i);
          setSurvey(q);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, secret]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!survey || !invitation) return;
    setBusy(true);
    setError("");
    try {
      const address = destination.trim();
      if (!/^otl_esm_/.test(address))
        throw new Error("Enter an Esmeralda testnet Ootle address.");
      const { parseOotleAddress } = await import("@tari-project/ootle-wasm");
      try {
        parseOotleAddress(address);
      } catch {
        throw new Error(
          "This Ootle address has an invalid checksum. Copy the full receiving address from your wallet.",
        );
      }
      for (const q of survey.questions) {
        const a = answers[q.id] ?? "";
        if (q.required && !a.trim())
          throw new Error("Please answer all required questions.");
        if (q.type === "choice" && a && !q.options.includes(a))
          throw new Error("Choose one of the available options.");
      }
      const envelope = await encryptResponse(
        invitation.publicKey,
        invitation.responseId,
        { answers, destination: address },
      );
      await api("/respond", token, envelope);
      setAnswers({});
      setDestination("");
      setInvitation(await api("/invitation", token));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (error && !survey)
    return (
      <main className="participant">
        <h1>Invitation unavailable</h1>
        <p className="error" role="alert">
          {error}
        </p>
      </main>
    );
  if (!survey)
    return (
      <main className="participant">
        <p>Opening your private invitation…</p>
      </main>
    );
  if (invitation.submitted)
    return (
      <main className="participant">
        <div className="thank-you">
          <svg
            width="54"
            height="54"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="24" cy="24" r="20" />
            <path d="m14 24 7 7 14-14" />
          </svg>
          <h1>Thank you for your time.</h1>
          <p>Your encrypted response has been delivered.</p>
          <div className="payment-state">
            <h2>
              {invitation.response?.status === "paid"
                ? "Your reward is on its way"
                : "Your reward is awaiting approval"}
            </h2>
            <p>
              {invitation.response?.status === "paid"
                ? "1 tTARI was sent to your private Ootle address. Check your wallet to receive it."
                : "The organizer will review your participation and approve your 1 tTARI reward."}
            </p>
            {invitation.response?.transaction_id && (
              <details>
                <summary>Payment receipt</summary>
                <code>{invitation.response.transaction_id}</code>
              </details>
            )}
          </div>
        </div>
      </main>
    );
  return (
    <main className="participant">
      <div className="participant-intro">
        <p className="reward-note">1 tTARI for approved participation</p>
        <h1>{survey.title}</h1>
        <p>{survey.introduction}</p>
      </div>
      {invitation.closed ? (
        <p className="notice">This survey is closed.</p>
      ) : (
        <form onSubmit={submit}>
          <div className="panel respondent-questions">
            {survey.questions.map((q, index) => (
              <div className="answer" key={q.id}>
                <label htmlFor={q.id}>
                  <span className="question-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {q.text}
                  {q.required && <span className="required"> *</span>}
                </label>
                {q.type === "long" ? (
                  <textarea
                    id={q.id}
                    rows={4}
                    maxLength={4000}
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                    required={q.required}
                  />
                ) : q.type === "choice" ? (
                  <select
                    id={q.id}
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                    required={q.required}
                  >
                    <option value="">Choose an answer</option>
                    {q.options.map((o, i) => (
                      <option key={i}>{o}</option>
                    ))}
                  </select>
                ) : q.type === "rating" ? (
                  <div className="rating" role="group" aria-label={q.text}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label
                        className={
                          answers[q.id] === String(n) ? "selected" : ""
                        }
                        key={n}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          value={n}
                          checked={answers[q.id] === String(n)}
                          onChange={() =>
                            setAnswers({ ...answers, [q.id]: String(n) })
                          }
                          required={q.required}
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    id={q.id}
                    maxLength={1000}
                    value={answers[q.id] ?? ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                    required={q.required}
                  />
                )}
              </div>
            ))}
          </div>
          <section className="panel reward-destination">
            <h2>Where should we send your reward?</h2>
            <label htmlFor="destination">Your Ootle testnet address</label>
            <input
              id="destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="otl_esm_…"
              required
              autoComplete="off"
              spellCheck={false}
            />
            <p className="small muted">
              Use your wallet’s Esmeralda receiving address. Never enter a seed
              phrase or private key. Your address is encrypted with your answers
              and visible to the organizer when approving payment.
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              I understand the organizer can read my answers and rewards require
              participation approval.
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || !consent}>
              {busy ? "Encrypting & submitting…" : "Submit private response"}
            </button>
          </section>
        </form>
      )}
      <p className="participant-footer">
        Your answers are encrypted before leaving this browser. They never go on
        the blockchain.
      </p>
    </main>
  );
}
