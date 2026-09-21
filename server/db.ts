import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
mkdirSync("data", { recursive: true });
export const db = new DatabaseSync(
  process.env.SURVEY_DB_FILE ?? "data/surveys.sqlite",
);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS surveys(id TEXT PRIMARY KEY,questions TEXT NOT NULL,admin_envelope TEXT NOT NULL,created_at TEXT NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY,survey_id TEXT NOT NULL REFERENCES surveys(id),response_id TEXT NOT NULL UNIQUE,submitted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY,survey_id TEXT NOT NULL REFERENCES surveys(id),envelope TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'submitted',receipt TEXT UNIQUE,transaction_id TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,object_id TEXT,time TEXT NOT NULL);
`);
export const setting = (key: string) => {
  const row = db
    .prepare("SELECT value FROM settings WHERE key=?")
    .get(key) as any;
  return row ? JSON.parse(row.value) : null;
};
export function setSetting(key: string, value: unknown) {
  db.prepare(
    "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, JSON.stringify(value));
}
export function audit(action: string, id?: string) {
  db.prepare("INSERT INTO audit(action,object_id,time) VALUES(?,?,?)").run(
    action,
    id ?? null,
    new Date().toISOString(),
  );
}
