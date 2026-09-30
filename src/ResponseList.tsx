import { useState } from "react";
import type {
  Answer,
  OrganizerData,
  ResponseRecord,
  SurveySecrets,
} from "./api";
export function ResponseList({
  data,
  secrets,
  answers,
  unlocked,
  busy,
  onUnlock,
  onPay,
  onCheck,
  onExport,
  filter,
  setFilter,
}: {
  data: OrganizerData;
  secrets: Record<string, SurveySecrets>;
  answers: Record<string, Answer>;
  unlocked: boolean;
  busy: boolean;
  onUnlock: () => void;
  onPay: (r: ResponseRecord) => void;
  onCheck: (r: ResponseRecord) => void;
  onExport: (rows: ResponseRecord[]) => void;
  filter: string;
  setFilter: (id: string) => void;
}) {
  const [status, setStatus] = useState("all"),
    [search, setSearch] = useState("");
  const rows = data.responses.filter(
    (r) =>
      (filter === "all" || r.survey_id === filter) &&
      (status === "all" ||
        (status === "pending"
          ? ["paying", "uncertain"].includes(r.status)
          : r.status === status)) &&
      (!search ||
        JSON.stringify(answers[r.id]?.answers ?? {})
          .toLowerCase()
          .includes(search.toLowerCase()) ||
        secrets[r.survey_id]?.title
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  return (
    <section className="panel response-list">
      <div className="section-head">
        <h2>
          Responses <span className="count-label">{rows.length}</span>
        </h2>
        <button
          className="outline compact"
          disabled={!unlocked || !rows.some((r) => answers[r.id])}
          onClick={() => onExport(rows)}
        >
          Export responses
        </button>
      </div>
      <div className="response-filters">
        <label>
          Survey
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All surveys</option>
            {data.surveys.map((s) => (
              <option key={s.id} value={s.id}>
                {secrets[s.id]?.title ?? "Encrypted questionnaire"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reward status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="submitted">Ready for review</option>
            <option value="pending">Payment needs checking</option>
            <option value="paid">Reward paid</option>
          </select>
        </label>
        <label>
          Search answers
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!unlocked}
            placeholder="Search in this browser"
            type="search"
          />
        </label>
      </div>
      {!unlocked ? (
        <div className="empty">
          <p>Unlock your vault to read responses.</p>
          <button className="outline" onClick={onUnlock}>
            Unlock vault
          </button>
        </div>
      ) : !rows.length ? (
        <div className="empty">
          <p>
            {data.responses.length
              ? "No responses match your filters."
              : "Responses will appear here after participants submit."}
          </p>
        </div>
      ) : (
        rows.map((r) => (
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
                    : "Payment needs checking"}
              </span>
            </div>
            {answers[r.id] ? (
              <>
                {secrets[r.survey_id]?.questions.map((q) => (
                  <div className="response-answer" key={q.id}>
                    <h4>{q.text}</h4>
                    <p>
                      {String(answers[r.id].answers?.[q.id] || "No answer")}
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
                This response cannot be decrypted. Reward approval is disabled.
              </p>
            )}
            {r.error && <p className="notice small">{r.error}</p>}
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
                  disabled={
                    busy ||
                    (r.status === "submitted" &&
                      (!answers[r.id]?.destination ||
                        !data.pool ||
                        data.pool.closed))
                  }
                  onClick={() =>
                    r.status === "submitted" ? onPay(r) : onCheck(r)
                  }
                >
                  {busy
                    ? "Working…"
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
  );
}
