import { useEffect, useState } from "react";
import {
  api,
  type Question,
  type Questionnaire,
  type SurveyRecord,
  type ResponseRecord,
  type SurveySecrets,
  type Answer,
} from "./api";
import { QuestionEditor } from "./QuestionEditor";
import { VaultDialog, backupVault, type Vault } from "./VaultDialog";
import { encryptResponse, decryptResponse } from "../lib/envelopes.mjs";
import { randomHex, seal, digest } from "../lib/survey-crypto";
const newQuestion = (): Question => ({
  id: randomHex(8),
  text: "",
  type: "short",
  required: false,
  options: ["", ""],
});
export function Admin({
  token,
  tab,
  setTab,
}: {
  token: string;
  tab: string;
  setTab: (v: string) => void;
}) {
  const [vault, setVault] = useState<Vault | null>(null),
    [vaultOpen, setVaultOpen] = useState(false),
    [title, setTitle] = useState(""),
    [introduction, setIntroduction] = useState(""),
    [questions, setQuestions] = useState<Question[]>([newQuestion()]),
    [count, setCount] = useState(5),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [data, setData] = useState<any>({
      surveys: [],
      responses: [],
      invitations: [],
    }),
    [secrets, setSecrets] = useState<Record<string, SurveySecrets>>({}),
    [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [links, setLinks] = useState<string[]>([]),
    [copyIndex, setCopyIndex] = useState(-1);
  async function refresh() {
    const d = await api("/admin/surveys", token);
    setData(d);
    if (vault) {
      const decrypted: Record<string, SurveySecrets> = {};
      for (const s of d.surveys as SurveyRecord[])
        decrypted[s.id] = await decryptResponse(
          vault.privateKey,
          s.id,
          JSON.parse(s.admin_envelope),
        );
      setSecrets(decrypted);
      const a: Record<string, Answer> = {};
      for (const r of d.responses as ResponseRecord[]) {
        try {
          a[r.id] = await decryptResponse(
            vault.privateKey,
            r.id,
            JSON.parse(r.envelope),
          );
        } catch {
          /* Invalid envelopes stay unpaid and are visible as unreadable. */
        }
      }
      setAnswers(a);
    }
  }
  useEffect(() => {
    let active = true;
    const load = () => {
      if (active) void refresh().catch((e) => setError(e.message));
    };
    load();
    const timer = setInterval(load, 7000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token, vault]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!vault) {
      setVaultOpen(true);
      return;
    }
    setBusy("Creating encrypted survey…");
    try {
      const cleaned = questions.map((q) => ({
        ...q,
        text: q.text.trim(),
        options: q.options.map((o) => o.trim()).filter(Boolean),
      }));
      if (
        cleaned.some(
          (q) =>
            !q.text ||
            (q.type === "choice" &&
              (q.options.length < 2 ||
                new Set(q.options).size !== q.options.length)),
        )
      )
        throw new Error(
          "Each multiple-choice question needs at least two distinct choices.",
        );
      const id = randomHex(),
        key = randomHex(),
        tokens = Array.from({ length: count }, () => randomHex());
      const questionnaire: Questionnaire = {
        title: title.trim(),
        introduction: introduction.trim(),
        questions: cleaned,
      };
      const privateData: SurveySecrets = { ...questionnaire, key, tokens };
      const invitations = await Promise.all(
        tokens.map(async (token) => ({
          tokenHash: await digest(token),
          responseId: randomHex(),
        })),
      );
      await api("/admin/surveys", token, {
        id,
        questions: await seal(
          key,
          questionnaire,
          "ootle-surveys/questions/" + id,
        ),
        adminEnvelope: await encryptResponse(vault.publicKey, id, privateData),
        invitations,
      });
      setLinks(tokens.map((t) => `${location.origin}/#invite=${t}&key=${key}`));
      setTitle("");
      setIntroduction("");
      setQuestions([newQuestion()]);
      setNotice("Survey created. Share one invitation link per participant.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function approve(response: ResponseRecord) {
    const a = answers[response.id];
    if (!a?.destination) {
      setError("This response has no readable reward address.");
      return;
    }
    setBusy(response.id);
    setError("");
    try {
      await api(`/admin/responses/${response.id}/pay`, token, {
        destination: a.destination,
      });
      setNotice("Private reward sent.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy("");
    }
  }
  async function close(id: string) {
    setBusy(id);
    setError("");
    try {
      await api(`/admin/surveys/${id}/close`, token, {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const activeSurveys = data.surveys as SurveyRecord[];
  return (
    <main className="organizer">
      <div className="intro">
        <div>
          <h1>
            {tab === "responses"
              ? "Every response matters."
              : "Good questions. Fair rewards."}
          </h1>
          <p>
            {tab === "responses"
              ? "Review participation and send a private thank-you."
              : "Create a private survey and thank people for their time."}
          </p>
        </div>
        <div className="vault-controls">
          {vault ? (
            <>
              <button
                className="text-button"
                onClick={() =>
                  void backupVault(token).catch((e) => setError(e.message))
                }
              >
                Back up vault
              </button>
              <button
                className="text-button muted"
                onClick={() => {
                  setVault(null);
                  setSecrets({});
                  setAnswers({});
                }}
              >
                Lock
              </button>
            </>
          ) : (
            <button className="outline" onClick={() => setVaultOpen(true)}>
              Unlock vault
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {tab === "surveys" ? (
        <>
          <form className="builder" onSubmit={create}>
            <section className="panel editor">
              <h2>New questionnaire</h2>
              <label htmlFor="survey-title">Survey title</label>
              <input
                id="survey-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What would you like to learn?"
                maxLength={120}
                required
              />
              <label htmlFor="survey-intro">Introduction</label>
              <textarea
                id="survey-intro"
                rows={2}
                value={introduction}
                onChange={(e) => setIntroduction(e.target.value)}
                placeholder="Tell participants what to expect."
                maxLength={1200}
              />
              <div className="questions">
                {questions.map((q, i) => (
                  <QuestionEditor
                    key={q.id}
                    question={q}
                    index={i}
                    canDelete={questions.length > 1}
                    onDelete={() =>
                      setQuestions(questions.filter((v) => v.id !== q.id))
                    }
                    onChange={(next) =>
                      setQuestions(
                        questions.map((v) => (v.id === q.id ? next : v)),
                      )
                    }
                  />
                ))}
              </div>
              <button
                className="outline add"
                type="button"
                disabled={questions.length >= 12}
                onClick={() => setQuestions([...questions, newQuestion()])}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M10 2v16M2 10h16" />
                </svg>
                Add question
              </button>
            </section>
            <aside className="panel reward-panel">
              <h2>Participation reward</h2>
              <div className="reward-amount">1 tTARI</div>
              <p>per approved response</p>
              <dl>
                <div>
                  <dt>
                    <label htmlFor="invitation-count">Invitations</label>
                  </dt>
                  <dd>
                    <input
                      id="invitation-count"
                      type="number"
                      value={count}
                      onChange={(e) => setCount(Number(e.target.value))}
                      min="1"
                      max="20"
                      required
                    />
                  </dd>
                </div>
                <div>
                  <dt>Reward budget</dt>
                  <dd className="budget">{count || 0} tTARI</dd>
                </div>
              </dl>
              <p className="reward-explainer">
                Answers are encrypted for you. Participants receive a private
                Ootle payment after approval.
              </p>
              <button className="primary full" disabled={!!busy || !data.pool}>
                {busy && !/^[a-f0-9]{64}$/.test(busy) ? busy : "Create survey"}
              </button>
              {!data.pool && (
                <p className="small muted">
                  Connecting the testnet reward pool…
                </p>
              )}
            </aside>
          </form>
          <section className="panel survey-list">
            <h2>Your surveys</h2>
            {!activeSurveys.length ? (
              <div className="empty">
                <svg
                  width="28"
                  height="32"
                  viewBox="0 0 28 32"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  aria-hidden="true"
                >
                  <path d="M6 2h10l7 7v21H6zM16 2v8h7M10 16h9M10 21h9" />
                </svg>
                <p>Your first questionnaire starts here.</p>
              </div>
            ) : (
              activeSurveys.map((s) => (
                <div className="survey-row" key={s.id}>
                  <div>
                    <h3>{secrets[s.id]?.title ?? "Encrypted questionnaire"}</h3>
                    <p>
                      {
                        data.responses.filter(
                          (r: ResponseRecord) => r.survey_id === s.id,
                        ).length
                      }{" "}
                      responses ·{" "}
                      {
                        data.invitations.filter(
                          (i: any) => i.survey_id === s.id,
                        ).length
                      }{" "}
                      invitations{s.closed ? " · Closed" : ""}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => {
                        if (!vault) {
                          setVaultOpen(true);
                          return;
                        }
                        const secret = secrets[s.id];
                        setLinks(
                          secret.tokens.map(
                            (t) =>
                              `${location.origin}/#invite=${t}&key=${secret.key}`,
                          ),
                        );
                      }}
                    >
                      Invitation links
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setTab("responses")}
                    >
                      Review responses
                    </button>
                    {!s.closed && (
                      <button
                        className="text-button muted"
                        disabled={!!busy}
                        onClick={() => void close(s.id)}
                      >
                        Close
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      ) : (
        <section className="panel response-list">
          <h2>Responses</h2>
          {!vault ? (
            <div className="empty">
              <p>Unlock your vault to read responses.</p>
              <button className="outline" onClick={() => setVaultOpen(true)}>
                Unlock vault
              </button>
            </div>
          ) : !data.responses.length ? (
            <div className="empty">
              <p>Responses will appear here after participants submit.</p>
            </div>
          ) : (
            (data.responses as ResponseRecord[]).map((r) => (
              <article className="response" key={r.id}>
                <div className="response-head">
                  <div>
                    <h3>{secrets[r.survey_id]?.title ?? "Survey response"}</h3>
                    <p className="small muted">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span className={"status " + r.status}>
                    {r.status === "paid"
                      ? "Reward paid"
                      : r.status === "submitted"
                        ? "Ready for review"
                        : "Payment pending"}
                  </span>
                </div>
                {answers[r.id] ? (
                  <>
                    {secrets[r.survey_id]?.questions.map((q) => (
                      <div className="response-answer" key={q.id}>
                        <h4>{q.text}</h4>
                        <p>
                          {String(answers[r.id].answers?.[q.id] ?? "No answer")}
                        </p>
                      </div>
                    ))}
                    <details>
                      <summary>Private reward address</summary>
                      <code>{answers[r.id].destination}</code>
                    </details>
                  </>
                ) : (
                  <p className="error">
                    This response cannot be decrypted. No reward has been sent.
                  </p>
                )}
                <div className="response-bottom">
                  {r.transaction_id && (
                    <details>
                      <summary>Payment receipt</summary>
                      <code>{r.transaction_id}</code>
                    </details>
                  )}
                  {r.status !== "paid" && (
                    <button
                      className="primary"
                      disabled={!!busy || !answers[r.id]}
                      onClick={() => void approve(r)}
                    >
                      {busy === r.id
                        ? "Sending private reward…"
                        : r.status === "submitted"
                          ? "Approve & pay 1 tTARI"
                          : "Check existing payment"}
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      )}
      {links.length > 0 && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="links-title"
            className="links-dialog"
          >
            <button
              className="close"
              aria-label="Close invitation links"
              onClick={() => setLinks([])}
            >
              ×
            </button>
            <h2 id="links-title">Your private invitations</h2>
            <p className="muted">
              Share a different link with each participant. Anyone with a link
              can open that invitation and submit once.
            </p>
            <div className="invitation-list">
              {links.map((link, i) => (
                <div className="invitation-row" key={link}>
                  <label htmlFor={"link-" + i}>Participant {i + 1}</label>
                  <input
                    id={"link-" + i}
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="outline"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(link)
                        .then(() => setCopyIndex(i))
                        .catch(() =>
                          setError("Select the link and copy it manually."),
                        )
                    }
                  >
                    {copyIndex === i ? "Copied" : "Copy"}
                  </button>
                </div>
              ))}
            </div>
            <p className="small muted">
              This local preview works on this computer. External participants
              need an HTTPS deployment.
            </p>
          </section>
        </div>
      )}
      {vaultOpen && (
        <VaultDialog
          token={token}
          onUnlock={setVault}
          onClose={() => setVaultOpen(false)}
        />
      )}
    </main>
  );
}
