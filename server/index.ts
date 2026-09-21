import express from "express";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { parseOotleAddress } from "@tari-project/ootle-wasm";
import {
  connect,
  NETWORK,
  pay,
  poolState,
  waitReceipt,
  type Deployment,
  type Wallet,
} from "../chain/ootle.ts";
import { db, setting, setSetting, audit } from "./db.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const tokenPath = "data/admin-access.txt";
let admin: string;
try {
  admin = (await readFile(tokenPath, "utf8")).trim();
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
  admin = randomBytes(32).toString("hex");
  await writeFile(tokenPath, admin, { mode: 0o600, flag: "wx" });
}
const adminHash = sha(admin);
const p = await connect();
let deployment: Deployment | undefined, wallet: Wallet | undefined;
try {
  deployment = JSON.parse(await readFile("data/deployment.json", "utf8"));
  const saved = JSON.parse(await readFile("data/operator.json", "utf8"));
  wallet = {
    signer: SecretKeyWallet.fromSecretKey(
      Buffer.from(saved.owner, "hex"),
      NETWORK,
      Buffer.from(saved.view, "hex"),
    ),
    account: deployment!.account,
    publicKey: deployment!.publicKey,
  };
} catch {}
const app = express();
app.disable("x-powered-by");
const port = Number(process.env.SURVEY_PORT ?? 4182);
const base = process.env.SURVEY_PUBLIC_ORIGIN ?? `http://127.0.0.1:${port}`;
const origins = new Set([
  base,
  "http://127.0.0.1:5182",
  "http://localhost:5182",
  `http://localhost:${port}`,
]);
const hosts = new Set([...origins].map((o) => new URL(o).hostname));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://ootle-indexer-a.tari.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (
    !hosts.has(req.hostname) ||
    (req.headers.origin && !origins.has(req.headers.origin))
  )
    return res.status(403).json({ error: "Origin not allowed" });
  next();
});
app.use(express.json({ limit: "400kb" }));
function bearer(req: express.Request) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new Error("Access link required.");
  return token;
}
const requireAdmin: express.RequestHandler = (req, res, next) => {
  try {
    if (
      !timingSafeEqual(
        Buffer.from(sha(bearer(req)), "hex"),
        Buffer.from(adminHash, "hex"),
      )
    )
      return res.status(401).json({ error: "Organizer access required." });
    next();
  } catch {
    res.status(401).json({ error: "Organizer access required." });
  }
};
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const encoded = z
  .string()
  .max(200000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/);
const envelope = z.object({
  version: z.literal(1),
  context: hex,
  iv: encoded,
  wrappedKey: encoded,
  ciphertext: encoded,
});
app.get("/api/config", (_req, res) =>
  res.json({
    network: "esmeralda",
    ready: !!deployment,
    reward: "1",
    vaultConfigured: !!setting("vault"),
    baseUrl: base,
  }),
);
app.get("/api/admin/vault", requireAdmin, (_req, res) =>
  res.json(setting("vault")),
);
app.post("/api/admin/vault", requireAdmin, (req, res) => {
  if (setting("vault"))
    return res
      .status(409)
      .json({
        error: "A vault already exists. Unlock it with its original password.",
      });
  const body = z
    .object({
      publicKey: z.object({
        kty: z.literal("RSA"),
        n: z.string(),
        e: z.string(),
        alg: z.string().optional(),
        ext: z.boolean().optional(),
        key_ops: z.array(z.string()).optional(),
      }),
      lockedKey: z.object({ salt: encoded, iv: encoded, data: encoded }),
    })
    .parse(req.body);
  setSetting("vault", body);
  audit("vault.created");
  res.status(201).json({ ok: true });
});
app.get("/api/admin/surveys", requireAdmin, async (_req, res) => {
  const surveys = db
    .prepare("SELECT * FROM surveys ORDER BY created_at DESC")
    .all();
  const invitations = db
    .prepare("SELECT survey_id,response_id,submitted FROM invitations")
    .all();
  const responses = db
    .prepare("SELECT * FROM responses ORDER BY created_at DESC")
    .all();
  res.json({
    surveys,
    invitations,
    responses,
    pool: deployment
      ? {
          ...deployment,
          ...(await poolState(p, deployment)),
          epoch: await p.getCurrentEpoch(),
        }
      : null,
  });
});
app.post("/api/admin/surveys", requireAdmin, async (req, res) => {
  if (!deployment) throw new Error("The reward pool is not connected.");
  if (!setting("vault")) throw new Error("Create your encryption vault first.");
  const body = z
    .object({
      id: hex,
      questions: z.object({ iv: encoded, data: encoded }),
      adminEnvelope: envelope,
      invitations: z
        .array(z.object({ tokenHash: hex, responseId: hex }))
        .min(1)
        .max(20),
    })
    .parse(req.body);
  if (body.adminEnvelope.context !== body.id)
    throw new Error("Invalid survey envelope context.");
  const pool = await poolState(p, deployment);
  if (pool.closed || (await p.getCurrentEpoch()) >= deployment.expiresEpoch)
    throw new Error("The reward pool has closed.");
  const reserved = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM invitations i JOIN surveys s ON s.id=i.survey_id LEFT JOIN responses r ON r.id=i.response_id WHERE (s.closed=0 OR i.submitted=1) AND (r.status IS NULL OR r.status!='paid')",
      )
      .get() as any
  ).n;
  if (reserved + body.invitations.length > 100 - pool.paid)
    throw new Error("There is not enough unreserved reward funding.");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO surveys(id,questions,admin_envelope,created_at) VALUES(?,?,?,?)",
    ).run(
      body.id,
      JSON.stringify(body.questions),
      JSON.stringify(body.adminEnvelope),
      new Date().toISOString(),
    );
    const insert = db.prepare(
      "INSERT INTO invitations(token_hash,survey_id,response_id) VALUES(?,?,?)",
    );
    for (const i of body.invitations)
      insert.run(i.tokenHash, body.id, i.responseId);
    audit("survey.created", body.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.status(201).json({ id: body.id });
});
app.post("/api/admin/surveys/:id/close", requireAdmin, (req, res) => {
  hex.parse(req.params.id);
  db.prepare("UPDATE surveys SET closed=1 WHERE id=?").run(
    String(req.params.id),
  );
  audit("survey.closed", String(req.params.id));
  res.json({ ok: true });
});
function invitation(req: express.Request) {
  const row = db
    .prepare(
      "SELECT i.*,s.questions,s.closed FROM invitations i JOIN surveys s ON s.id=i.survey_id WHERE token_hash=?",
    )
    .get(sha(bearer(req))) as any;
  if (!row) throw new Error("Invitation not found.");
  return row;
}
app.get("/api/invitation", (req, res) => {
  const i = invitation(req);
  const response = db
    .prepare("SELECT status,transaction_id FROM responses WHERE id=?")
    .get(i.response_id);
  res.json({
    responseId: i.response_id,
    surveyId: i.survey_id,
    questions: JSON.parse(i.questions),
    publicKey: setting("vault").publicKey,
    submitted: !!i.submitted,
    closed: !!i.closed,
    response,
    reward: "1",
  });
});
app.post("/api/respond", (req, res) => {
  const i = invitation(req);
  if (i.closed) throw new Error("This survey is closed.");
  const body = envelope.parse(req.body);
  if (body.context !== i.response_id)
    throw new Error("Invalid response context.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db
      .prepare(
        "UPDATE invitations SET submitted=1 WHERE token_hash=? AND submitted=0",
      )
      .run(i.token_hash);
    if (changed.changes !== 1)
      throw new Error("This invitation has already been used.");
    db.prepare(
      "INSERT INTO responses(id,survey_id,envelope,created_at) VALUES(?,?,?,?)",
    ).run(
      i.response_id,
      i.survey_id,
      JSON.stringify(body),
      new Date().toISOString(),
    );
    audit("response.received", i.response_id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.status(201).json({ ok: true });
});
let paying = false;
app.post("/api/admin/responses/:id/pay", requireAdmin, async (req, res) => {
  if (paying)
    return res
      .status(409)
      .json({ error: "Another payment is being processed. Please wait." });
  if (!deployment || !wallet) throw new Error("Reward pool unavailable.");
  const id = hex.parse(req.params.id);
  const { destination } = z
    .object({
      destination: z
        .string()
        .min(60)
        .max(300)
        .regex(/^otl_esm_/),
    })
    .parse(req.body);
  try {
    parseOotleAddress(destination);
  } catch {
    throw new Error("Invalid Ootle receiving address.");
  }
  const row = db.prepare("SELECT * FROM responses WHERE id=?").get(id) as any;
  if (!row) throw new Error("Response not found.");
  if (row.status === "paid")
    return res.json({ status: "paid", transaction: row.transaction_id });
  paying = true;
  try {
    if (row.status === "paying" || row.status === "uncertain") {
      if (row.transaction_id) {
        await waitReceipt(p, row.transaction_id);
        db.prepare(
          "UPDATE responses SET status='paid',error=NULL WHERE id=?",
        ).run(id);
        return res.json({ status: "paid", transaction: row.transaction_id });
      }
      const state = await poolState(p, deployment);
      if (row.receipt && state.raw[6].includes(row.receipt)) {
        db.prepare(
          "UPDATE responses SET status='paid',error=NULL WHERE id=?",
        ).run(id);
        audit("reward.reconciled", id);
        return res.json({ status: "paid", transaction: null });
      }
      throw new Error(
        "Payment needs reconciliation before another submission.",
      );
    }
    const receipt = row.receipt ?? randomBytes(32).toString("hex");
    db.prepare(
      "UPDATE responses SET status='paying',receipt=?,error=NULL WHERE id=?",
    ).run(receipt, id);
    audit("reward.approved", id);
    const result = await pay(
      p,
      wallet,
      deployment,
      receipt,
      destination,
      (tx) => {
        db.prepare("UPDATE responses SET transaction_id=? WHERE id=?").run(
          tx,
          id,
        );
      },
    );
    db.prepare("UPDATE responses SET status='paid',error=NULL WHERE id=?").run(
      id,
    );
    audit("reward.paid", id);
    res.json({ status: "paid", transaction: result.id });
  } catch (e) {
    db.prepare(
      "UPDATE responses SET status='uncertain',error=? WHERE id=?",
    ).run("Check the existing transaction before retrying.", id);
    throw e;
  } finally {
    paying = false;
  }
});
app.use(express.static(resolve("dist")));
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      error instanceof z.ZodError
        ? "Invalid request."
        : (error.message ?? "Request failed.");
    res.status(400).json({ error: message });
  },
);
app.listen(port, "127.0.0.1", () =>
  console.log(
    `Ootle Surveys running at http://127.0.0.1:${port}. Organizer access is in data/admin-access.txt.`,
  ),
);
