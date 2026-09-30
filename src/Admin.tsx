import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type OrganizerData,
  type SurveySecrets,
  type Answer,
  type Draft,
  type ResponseRecord,
} from "./api";
import { VaultDialog, backupVault, type Vault } from "./VaultDialog";
import { SurveyBuilder, emptyDraft } from "./SurveyBuilder";
import { ResponseList } from "./ResponseList";
import { InvitationDialog, type InvitationLink } from "./InvitationDialog";
import { Dialog } from "./Dialog";
import { encryptResponse, decryptResponse } from "../lib/envelopes.mjs";
import { randomHex, seal, digest } from "../lib/survey-crypto";
import { csv, download } from "../lib/export.mjs";
const emptyData: OrganizerData = {
  surveys: [],
  responses: [],
  invitations: [],
  drafts: [],
  pool: null,
  poolError: null,
  baseUrl: location.origin,
};
export function Admin({
  token,
  tab,
  setTab,
  onUnauthorized,
}: {
  token: string;
  tab: string;
  setTab: (v: string) => void;
  onUnauthorized: () => void;
}) {
  const [vault, setVault] = useState<Vault | null>(null),
    [vaultOpen, setVaultOpen] = useState(false),
    [draft, setDraft] = useState(emptyDraft),
    [draftId, setDraftId] = useState(() => randomHex()),
    [savedDraft, setSavedDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [data, setData] = useState<OrganizerData>(emptyData),
    [secrets, setSecrets] = useState<Record<string, SurveySecrets>>({}),
    [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    [links, setLinks] = useState<InvitationLink[]>([]),
    [filter, setFilter] = useState("all"),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<void> | void;
    } | null>(null);
  const currentVault = useRef(vault),
    mounted = useRef(true),
    operation = useRef(false);
  currentVault.current = vault;
  const dirty =
    !!savedDraft ||
    !!draft.title ||
    !!draft.introduction ||
    draft.count !== 5 ||
    draft.questions.length !== 1 ||
    draft.questions.some(
      (q) =>
        q.text || q.required || q.type !== "short" || q.options.some(Boolean),
    )
      ? JSON.stringify(draft) !== savedDraft
      : false;
  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        (e as Error).message ||
          "Unable to reach the server. Check your connection.",
      );
    },
    [onUnauthorized],
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const d = await api<OrganizerData>(
        "/admin/surveys",
        token,
        undefined,
        signal,
      );
      if (!mounted.current || signal?.aborted) return;
      setData(d);
      setLoaded(true);
      if (!vault) return;
      const decrypt = async <T,>(
        records: { id: string; value: string }[],
      ): Promise<Record<string, T>> => {
        const values = await Promise.all(
          records.map(async (r) => {
            try {
              return [
                r.id,
                await decryptResponse(
                  vault.privateKey,
                  r.id,
                  JSON.parse(r.value),
                ),
              ] as const;
            } catch {
              return null;
            }
          }),
        );
        return Object.fromEntries(values.filter((v) => v !== null)) as Record<
          string,
          T
        >;
      };
      const [s, a, dr] = await Promise.all([
        decrypt<SurveySecrets>(
          d.surveys.map((r) => ({ id: r.id, value: r.admin_envelope })),
        ),
        decrypt<Answer>(
          d.responses.map((r) => ({ id: r.id, value: r.envelope })),
        ),
        decrypt<Draft>(d.drafts.map((r) => ({ id: r.id, value: r.envelope }))),
      ]);
      if (!mounted.current || signal?.aborted || currentVault.current !== vault)
        return;
      setSecrets(s);
      setAnswers(a);
      setDrafts(dr);
    },
    [token, vault],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) handleError(e);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 10000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh, handleError]);
  function reset() {
    setDraft(emptyDraft());
    setDraftId(randomHex());
    setSavedDraft("");
  }
  function lock() {
    currentVault.current = null;
    setVault(null);
    setSecrets({});
    setAnswers({});
    setDrafts({});
    setLinks([]);
    setConfirm(null);
    reset();
    setNotice(
      "Vault locked. Unlock it to resume saved drafts and read responses.",
    );
  }
  useEffect(() => {
    if (!vault) return;
    let lastActivity = Date.now();
    const activity = () => {
      lastActivity = Date.now();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    const timer = setInterval(() => {
      if (Date.now() - lastActivity > 15 * 60 * 1000 && !operation.current)
        lock();
    }, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [vault]);
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      handleError(e);
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function saveDraft() {
    if (!vault) {
      setVaultOpen(true);
      return;
    }
    const contents = JSON.stringify(draft);
    await run(async () => {
      await api("/admin/drafts", token, {
        id: draftId,
        envelope: await encryptResponse(vault.publicKey, draftId, draft),
      });
      setSavedDraft(contents);
      setNotice(
        "Encrypted draft saved. You can resume it after unlocking your vault.",
      );
      await refresh();
    });
  }
  async function create(clean: Draft) {
    if (!vault) {
      setVaultOpen(true);
      return;
    }
    await run(async () => {
      const id = randomHex(),
        key = randomHex(),
        tokens = Array.from({ length: clean.count }, () => randomHex());
      const { count: _count, ...questionnaire } = clean;
      await api("/admin/surveys", token, {
        id,
        draftId,
        questions: await seal(
          key,
          questionnaire,
          "ootle-surveys/questions/" + id,
        ),
        adminEnvelope: await encryptResponse(vault.publicKey, id, {
          ...questionnaire,
          key,
          tokens,
        }),
        invitations: await Promise.all(
          tokens.map(async (t) => ({
            tokenHash: await digest(t),
            responseId: randomHex(),
          })),
        ),
      });
      setLinks(
        tokens.map((t) => ({
          url: `${data.baseUrl}/#invite=${t}&key=${key}`,
          submitted: false,
        })),
      );
      reset();
      setNotice(
        "Survey created. Share one private invitation per participant.",
      );
      await refresh();
    });
  }
  function requestChange(
    title: string,
    text: string,
    action: () => Promise<void> | void,
  ) {
    setConfirm({ title, text, action });
  }
  function invitations(id: string) {
    if (!vault) {
      setVaultOpen(true);
      return;
    }
    const secret = secrets[id];
    if (!secret) {
      setError("This questionnaire cannot be decrypted with your vault.");
      return;
    }
    // Invitation rows preserve insertion order, matching the encrypted token list.
    const records = data.invitations.filter((i) => i.survey_id === id);
    setLinks(
      secret.tokens.map((t, i) => ({
        url: `${data.baseUrl}/#invite=${t}&key=${secret.key}`,
        submitted: !!records[i]?.submitted,
      })),
    );
  }
  function approve(r: ResponseRecord) {
    requestChange(
      "Approve participation",
      "Send one private 1 tTARI reward for this response? Review participation independently of what the answers say. Testnet transaction fees are paid by your operator wallet.",
      () =>
        run(async () => {
          await api(`/admin/responses/${r.id}/pay`, token, {
            destination: answers[r.id]?.destination,
          });
          setNotice("Private reward confirmed.");
          await refresh();
        }),
    );
  }
  function check(r: ResponseRecord) {
    void run(async () => {
      const result = await api(`/admin/responses/${r.id}/check`, token, {});
      setNotice(
        result.status === "paid"
          ? "Existing payment confirmed."
          : result.message,
      );
      await refresh();
    });
  }
  function exportResponses(rows: ResponseRecord[]) {
    requestChange(
      "Export decrypted responses",
      "This CSV contains readable answers. Keep the downloaded file private. Reward addresses are excluded. Only decryptable responses matching your filters are exported.",
      () => {
        download(
          csv([
            [
              "Survey",
              "Response ID",
              "Submitted",
              "Reward status",
              "Question",
              "Answer",
            ],
            ...rows.flatMap((r) =>
              answers[r.id]
                ? (secrets[r.survey_id]?.questions ?? []).map((q) => [
                    secrets[r.survey_id].title,
                    r.id,
                    r.created_at,
                    r.status,
                    q.text,
                    answers[r.id].answers?.[q.id] ?? "",
                  ])
                : [],
            ),
          ]),
          "ootle-surveys-responses.csv",
          "text/csv;charset=utf-8",
        );
        setNotice("Responses exported in this browser.");
      },
    );
  }
  const ready = data.responses.filter((r) => r.status === "submitted").length;
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
                onClick={() => void backupVault(token).catch(handleError)}
              >
                Back up vault
              </button>
              <button
                className="text-button muted"
                disabled={busy}
                onClick={() =>
                  dirty
                    ? requestChange(
                        "Lock vault?",
                        "Unsaved edits will be cleared. Save an encrypted draft first if you want to keep them.",
                        lock,
                      )
                    : lock()
                }
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
      <div className="workspace-status" aria-label="Workspace status">
        <div>
          <span className="small muted">Active surveys</span>
          <strong>{data.surveys.filter((s) => !s.closed).length}</strong>
        </div>
        <div>
          <span className="small muted">Awaiting review</span>
          <button
            className="metric-button"
            onClick={() => {
              setFilter("all");
              setTab("responses");
            }}
          >
            {ready}
          </button>
        </div>
        <div>
          <span className="small muted">Rewards paid</span>
          <strong>
            {data.responses.filter((r) => r.status === "paid").length} tTARI
          </strong>
        </div>
        <div>
          <span className="small muted">Available funding</span>
          <strong>
            {data.pool ? `${data.pool.available} tTARI` : "Unavailable"}
          </strong>
        </div>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          Refresh
        </button>
      </div>
      {!loaded ? (
        <p className="notice" role="status">
          Loading your encrypted workspace…
        </p>
      ) : data.poolError ? (
        <p className="notice small" role="status">
          {data.poolError}
        </p>
      ) : data.pool?.closed ? (
        <p className="notice small">
          The reward pool has expired. You can review and export responses, but
          new rewards cannot be paid.
        </p>
      ) : (
        <p className="pool-detail small muted">
          {data.pool?.reserved} tTARI reserved for invitations and unpaid
          responses · Pool closes at epoch {data.pool?.expiresEpoch} · Current
          epoch {data.pool?.epoch}
        </p>
      )}
      {tab === "surveys" ? (
        <>
          <SurveyBuilder
            key={vault ? "unlocked" : "locked"}
            draft={draft}
            setDraft={setDraft}
            dirty={dirty}
            pool={data.pool}
            busy={busy}
            unlocked={!!vault}
            onSave={() => void saveDraft()}
            onCreate={(d) => void create(d)}
            onReset={() =>
              dirty
                ? requestChange(
                    "Start a new questionnaire?",
                    "Unsaved edits will be cleared. Your saved drafts stay available below.",
                    reset,
                  )
                : reset()
            }
          />
          {data.drafts.length > 0 && (
            <section className="panel survey-list">
              <h2>Saved drafts</h2>
              {data.drafts.map((d) => (
                <div className="survey-row" key={d.id}>
                  <div>
                    <h3>{drafts[d.id]?.title || "Encrypted draft"}</h3>
                    <p>
                      Saved {new Date(d.updated_at).toLocaleString()} · No
                      funding reserved
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      disabled={!!vault && !drafts[d.id]}
                      onClick={() => {
                        if (!vault) {
                          setVaultOpen(true);
                          return;
                        }
                        if (!drafts[d.id]) {
                          setError(
                            "This draft cannot be decrypted with your vault.",
                          );
                          return;
                        }
                        const resume = () => {
                          setDraft(drafts[d.id]);
                          setDraftId(d.id);
                          setSavedDraft(JSON.stringify(drafts[d.id]));
                          setNotice("Saved draft opened in the builder.");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        };
                        if (dirty)
                          requestChange(
                            "Open saved draft?",
                            "Unsaved edits in the builder will be cleared.",
                            resume,
                          );
                        else resume();
                      }}
                    >
                      Resume draft
                    </button>
                    <button
                      className="text-button muted"
                      disabled={busy}
                      onClick={() =>
                        requestChange(
                          "Delete saved draft?",
                          "This removes the encrypted draft. Published surveys and responses are preserved.",
                          () =>
                            run(async () => {
                              await api(
                                `/admin/drafts/${d.id}/delete`,
                                token,
                                {},
                              );
                              if (draftId === d.id) setSavedDraft("");
                              await refresh();
                            }),
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <section className="panel survey-list">
            <h2>Your surveys</h2>
            {!data.surveys.length ? (
              <div className="empty">
                <p>Your first questionnaire starts here.</p>
              </div>
            ) : (
              data.surveys.map((s) => {
                const rows = data.responses.filter((r) => r.survey_id === s.id);
                const invitationsCount = data.invitations.filter(
                  (i) => i.survey_id === s.id,
                ).length;
                return (
                  <div className="survey-row" key={s.id}>
                    <div>
                      <h3>
                        {secrets[s.id]?.title ?? "Encrypted questionnaire"}
                      </h3>
                      <p>
                        {rows.length} of {invitationsCount} responses ·{" "}
                        {rows.filter((r) => r.status === "paid").length} rewards
                        paid · {s.closed ? "Closed" : "Open"}
                      </p>
                    </div>
                    <div className="row-actions">
                      <button
                        className="text-button"
                        disabled={!!vault && !secrets[s.id]}
                        onClick={() => invitations(s.id)}
                      >
                        Invitation links
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          setFilter(s.id);
                          setTab("responses");
                        }}
                      >
                        Review responses
                      </button>
                      {!s.closed && (
                        <button
                          className="text-button muted"
                          disabled={busy}
                          onClick={() =>
                            requestChange(
                              "Close this survey?",
                              "Unused invitations will stop accepting responses and release their reserved funding. Existing responses can still be reviewed and rewarded before the pool expires.",
                              () =>
                                run(async () => {
                                  await api(
                                    `/admin/surveys/${s.id}/close`,
                                    token,
                                    {},
                                  );
                                  setNotice(
                                    "Survey closed. Existing responses remain available.",
                                  );
                                  await refresh();
                                }),
                            )
                          }
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </>
      ) : (
        <ResponseList
          data={data}
          secrets={secrets}
          answers={answers}
          unlocked={!!vault}
          busy={busy}
          filter={filter}
          setFilter={setFilter}
          onUnlock={() => setVaultOpen(true)}
          onPay={approve}
          onCheck={check}
          onExport={exportResponses}
        />
      )}
      {links.length > 0 && (
        <InvitationDialog links={links} onClose={() => setLinks([])} />
      )}
      {confirm && (
        <Dialog title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="dialog-actions">
            <button className="outline" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="primary"
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void action();
              }}
            >
              Confirm
            </button>
          </div>
        </Dialog>
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
