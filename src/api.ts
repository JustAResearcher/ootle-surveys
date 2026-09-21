export async function api<T = any>(
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error ?? "Request failed");
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
