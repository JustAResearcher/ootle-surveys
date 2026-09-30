import { useEffect, useState } from "react";
import { QuestionEditor } from "./QuestionEditor";
import { Dialog } from "./Dialog";
import { randomHex } from "../lib/survey-crypto";
import type { Draft, OrganizerData, Question } from "./api";
export const newQuestion = (): Question => ({
  id: randomHex(8),
  text: "",
  type: "short",
  required: false,
  options: ["", ""],
});
export const emptyDraft = (): Draft => ({
  title: "",
  introduction: "",
  questions: [newQuestion()],
  count: 5,
});
export function cleanDraft(draft: Draft): Draft {
  if (!draft.title.trim()) throw new Error("Give your survey a title.");
  if (!Number.isInteger(draft.count) || draft.count < 1 || draft.count > 20)
    throw new Error("Choose between 1 and 20 invitations.");
  const questions = draft.questions.map((q) => ({
    ...q,
    text: q.text.trim(),
    options: q.options.map((o) => o.trim()).filter(Boolean),
  }));
  if (questions.some((q) => !q.text))
    throw new Error("Write a question in every question field.");
  if (
    questions.some(
      (q) =>
        q.type === "choice" &&
        (q.options.length < 2 || new Set(q.options).size !== q.options.length),
    )
  )
    throw new Error(
      "Each multiple-choice question needs at least two distinct choices.",
    );
  return {
    ...draft,
    title: draft.title.trim(),
    introduction: draft.introduction.trim(),
    questions,
  };
}
export function SurveyBuilder({
  draft,
  setDraft,
  dirty,
  pool,
  busy,
  unlocked,
  onSave,
  onCreate,
  onReset,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  dirty: boolean;
  pool: OrganizerData["pool"];
  busy: boolean;
  unlocked: boolean;
  onSave: () => void;
  onCreate: (d: Draft) => void;
  onReset: () => void;
}) {
  const [preview, setPreview] = useState<Draft | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function checked(action: (d: Draft) => void) {
    try {
      setError("");
      action(cleanDraft(draft));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const canFund = pool && !pool.closed && draft.count <= pool.available;
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          checked(onCreate);
        }}
      >
        <fieldset className="builder" disabled={busy}>
          <section className="panel editor">
            <div className="section-head">
              <h2>New questionnaire</h2>
              <span className="small muted">
                {dirty ? "Unsaved changes" : "Ready to edit"}
              </span>
            </div>
            <label htmlFor="survey-title">Survey title</label>
            <input
              id="survey-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="What would you like to learn?"
              maxLength={120}
              required
            />
            <label htmlFor="survey-intro">Introduction</label>
            <textarea
              id="survey-intro"
              rows={2}
              value={draft.introduction}
              onChange={(e) =>
                setDraft({ ...draft, introduction: e.target.value })
              }
              placeholder="Tell participants what to expect."
              maxLength={1200}
            />
            <div className="questions">
              {draft.questions.map((q, i) => (
                <QuestionEditor
                  key={q.id}
                  question={q}
                  index={i}
                  total={draft.questions.length}
                  canDelete={draft.questions.length > 1}
                  onDelete={() =>
                    setDraft({
                      ...draft,
                      questions: draft.questions.filter((v) => v.id !== q.id),
                    })
                  }
                  onChange={(next) =>
                    setDraft({
                      ...draft,
                      questions: draft.questions.map((v) =>
                        v.id === q.id ? next : v,
                      ),
                    })
                  }
                  onMove={(direction) => {
                    const questions = [...draft.questions];
                    [questions[i], questions[i + direction]] = [
                      questions[i + direction],
                      questions[i],
                    ];
                    setDraft({ ...draft, questions });
                  }}
                />
              ))}
            </div>
            <div className="builder-actions">
              <button
                className="outline add"
                type="button"
                disabled={draft.questions.length >= 12}
                onClick={() =>
                  setDraft({
                    ...draft,
                    questions: [...draft.questions, newQuestion()],
                  })
                }
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
              <button
                className="text-button"
                type="button"
                onClick={() => checked(setPreview)}
              >
                Preview
              </button>
              <button
                className="text-button muted"
                type="button"
                disabled={busy}
                onClick={onReset}
              >
                Start fresh
              </button>
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
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
                    value={Number.isNaN(draft.count) ? "" : draft.count}
                    onChange={(e) =>
                      setDraft({ ...draft, count: e.target.valueAsNumber })
                    }
                    min={1}
                    max={20}
                    required
                  />
                </dd>
              </div>
              <div>
                <dt>Reward budget</dt>
                <dd className="budget">{draft.count || 0} tTARI</dd>
              </div>
            </dl>
            <p className="reward-explainer">
              Answers are encrypted for you. Participants receive a private
              Ootle payment after approval.
            </p>
            <button className="primary full" disabled={busy || !canFund}>
              {busy ? "Working…" : "Create survey"}
            </button>
            <button
              className="outline full save-draft"
              type="button"
              disabled={busy}
              onClick={onSave}
            >
              Save encrypted draft
            </button>
            <p className="small muted reward-help">
              {!unlocked
                ? "Unlock your vault to save or publish a questionnaire."
                : pool?.closed
                  ? "The pool has expired. Drafts can still be saved."
                  : !pool
                    ? "Drafts work without a connected reward pool."
                    : !canFund
                      ? "Reduce invitations to fit the available reward funding."
                      : `${pool.available} tTARI available for new invitations.`}
            </p>
          </aside>
        </fieldset>
      </form>
      {preview && (
        <Dialog
          title="Participant preview"
          onClose={() => setPreview(null)}
          wide
        >
          <div className="preview">
            <h3>{preview.title}</h3>
            <p>{preview.introduction}</p>
            {preview.questions.map((q, i) => (
              <div className="answer" key={q.id}>
                <label htmlFor={"preview-" + q.id}>
                  {i + 1}. {q.text}
                  {q.required ? " *" : ""}
                </label>
                {q.type === "long" ? (
                  <textarea id={"preview-" + q.id} rows={3} />
                ) : q.type === "choice" ? (
                  <select id={"preview-" + q.id}>
                    <option>Choose an answer</option>
                    {q.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : q.type === "rating" ? (
                  <select id={"preview-" + q.id}>
                    <option>Choose a rating</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <input id={"preview-" + q.id} />
                )}
              </div>
            ))}
            <p className="small muted">
              Preview only. No response or reward will be submitted.
            </p>
          </div>
        </Dialog>
      )}
    </>
  );
}
