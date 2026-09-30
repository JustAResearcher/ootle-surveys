export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const value = await r.json().catch(() => {
    throw new Error(
      "The server returned an unreadable response. Check your connection.",
    );
  });
  if (!r.ok) throw new ApiError(value.error ?? "Request failed", r.status);
  return value;
}
export type Question = {
  id: string;
  text: string;
  type: "short" | "long" | "choice" | "rating";
  required: boolean;
  options: string[];
};
export type Questionnaire = {
  title: string;
  introduction: string;
  questions: Question[];
};
export type SurveyRecord = {
  id: string;
  questions: string;
  admin_envelope: string;
  created_at: string;
  closed: number;
};
export type ResponseRecord = {
  id: string;
  survey_id: string;
  envelope: string;
  created_at: string;
  status: string;
  receipt: string | null;
  transaction_id: string | null;
  error: string | null;
};
export type SurveySecrets = Questionnaire & { key: string; tokens: string[] };
export type Answer = { answers: Record<string, string>; destination: string };
export type Draft = Questionnaire & { count: number };
export type DraftRecord = { id: string; envelope: string; updated_at: string };
export type InvitationRecord = {
  survey_id: string;
  response_id: string;
  submitted: number;
};
export type OrganizerData = {
  surveys: SurveyRecord[];
  responses: ResponseRecord[];
  invitations: InvitationRecord[];
  drafts: DraftRecord[];
  baseUrl: string;
  poolError: string | null;
  pool: {
    paid: number;
    remaining: number;
    reserved: number;
    available: number;
    closed: boolean;
    epoch: number;
    expiresEpoch: number;
  } | null;
};
