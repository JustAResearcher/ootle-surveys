import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { startTestApp } from "./helpers.mjs";
import {
  createOrganizerKeys,
  exportPublicKey,
  encryptResponse,
} from "../lib/envelopes.mjs";
import { csv } from "../lib/export.mjs";
const random = () => randomBytes(32).toString("hex");
const sha = (value) => createHash("sha256").update(value).digest("hex");
test("CSV export escapes quotes, newlines and spreadsheet formulas", () => {
  const out = csv([
    [
      "hello, world",
      'a"b',
      "line\nnext",
      '=HYPERLINK("x")',
      " @SUM(1)",
      "-1",
      "plain",
    ],
  ]);
  assert.ok(out.includes('"hello, world"'));
  assert.ok(out.includes('"a""b"'));
  assert.ok(out.includes("\"'=HYPERLINK"));
  assert.ok(out.includes("\"' @SUM"));
  assert.ok(out.includes('"\'-1"'));
  assert.ok(out.includes('"line\nnext"'));
});
test("isolated HTTP lifecycle: encrypted drafts, live balance reservations, responses, reconciliation and complete backup", async (t) => {
  const app = await startTestApp({
    publicOrigin: "https://surveys.example.org",
  });
  let db;
  t.after(async () => {
    db?.close();
    await app.stop();
  });
  const { request } = app;
  assert.equal((await request("/admin/session", "bad")).status, 401);
  assert.equal((await request("/admin/drafts", random(), {})).status, 401);
  assert.equal(
    (
      await request("/admin/session", app.admin, undefined, {
        Origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  const keys = await createOrganizerKeys(true);
  const vault = {
    publicKey: await exportPublicKey(keys.publicKey),
    lockedKey: { salt: "AA==", iv: "AA==", data: "AA==" },
  };
  assert.equal((await request("/admin/vault", app.admin, vault)).status, 201);
  const draftId = random();
  const envelope = await encryptResponse(vault.publicKey, draftId, {
    title: "PRIVATE-DRAFT-SENTINEL",
    questions: [],
  });
  assert.equal(
    (await request("/admin/drafts", app.admin, { id: draftId, envelope }))
      .status,
    200,
  );
  assert.equal(
    (await request("/admin/drafts", app.admin, { id: random(), envelope }))
      .status,
    400,
  );
  const initial = (await request("/admin/surveys")).value;
  assert.equal(initial.baseUrl, "https://surveys.example.org");
  assert.equal(initial.pool.available, 3);
  assert.equal(initial.drafts.length, 1);
  assert.ok(!JSON.stringify(initial).includes("PRIVATE-DRAFT-SENTINEL"));
  const id = random(),
    tokens = [random(), random()],
    responseIds = [random(), random()];
  const survey = {
    id,
    draftId,
    questions: { iv: "AA==", data: "AA==" },
    adminEnvelope: await encryptResponse(vault.publicKey, id, {
      title: "PRIVATE-SURVEY-SENTINEL",
    }),
    invitations: tokens.map((token, i) => ({
      tokenHash: sha(token),
      responseId: responseIds[i],
    })),
  };
  assert.equal(
    (await request("/admin/surveys", app.admin, survey)).status,
    201,
  );
  const next = (await request("/admin/surveys")).value;
  assert.equal(next.drafts.length, 0);
  assert.equal(next.pool.reserved, 2);
  assert.equal(next.pool.available, 1);
  // Concurrent creations must not overbook the last remaining funded reward.
  const bodies = await Promise.all(
    [0, 1].map(async () => {
      const id = random();
      return {
        ...survey,
        id,
        draftId: undefined,
        adminEnvelope: await encryptResponse(vault.publicKey, id, {
          title: "concurrent",
        }),
        invitations: [{ tokenHash: random(), responseId: random() }],
      };
    }),
  );
  const creations = await Promise.all(
    bodies.map((body) => request("/admin/surveys", app.admin, body)),
  );
  assert.deepEqual(creations.map((r) => r.status).sort(), [201, 400]);
  const answer = await encryptResponse(vault.publicKey, responseIds[0], {
    answers: { q: "PRIVATE-ANSWER-SENTINEL" },
    destination: "encrypted-destination",
  });
  assert.equal((await request("/respond", tokens[1], answer)).status, 400);
  assert.equal((await request("/respond", tokens[0], answer)).status, 201);
  assert.equal((await request("/respond", tokens[0], answer)).status, 400);
  assert.equal(
    (await request("/admin/surveys/" + id + "/close", app.admin, {})).status,
    200,
  );
  const second = await encryptResponse(vault.publicKey, responseIds[1], {
    answers: {},
  });
  assert.equal((await request("/respond", tokens[1], second)).status, 400);
  assert.equal(
    (await request("/admin/surveys/" + random() + "/close", app.admin, {}))
      .status,
    404,
  );
  assert.equal((await request("/not-a-route")).status, 404);
  db = new DatabaseSync(join(app.directory, "surveys.sqlite"));
  const receipt = random();
  db.prepare(
    "UPDATE responses SET status='uncertain',receipt=? WHERE id=?",
  ).run(receipt, responseIds[0]);
  const pending = await request(
    `/admin/responses/${responseIds[0]}/check`,
    app.admin,
    {},
  );
  assert.equal(pending.value.status, "uncertain");
  assert.equal(app.state.posts, 0);
  app.state.receipts.push(receipt);
  const reconciled = await request(
    `/admin/responses/${responseIds[0]}/check`,
    app.admin,
    {},
  );
  assert.equal(reconciled.value.status, "paid");
  assert.equal(app.state.posts, 0);
  app.state.epoch = 200;
  assert.equal(
    (await request("/invitation", tokens[0])).value.rewardState,
    "closed",
  );
  const expired = (await request("/admin/surveys")).value;
  assert.equal(expired.pool.closed, true);
  assert.equal(expired.responses[0].status, "paid");
  // Reconciliation resets the funding cache; wait for its short TTL before forcing an outage.
  await new Promise((resolve) => setTimeout(resolve, 5100));
  app.state.offline = true;
  const offline = (await request("/admin/surveys")).value;
  assert.equal(offline.pool, null);
  assert.equal(offline.surveys.length, 2);
  assert.ok(offline.poolError);
  assert.equal(
    (await request("/admin/drafts", app.admin, { id: draftId, envelope }))
      .status,
    200,
  );
  const exit = await new Promise((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/backup.ts", join(app.directory, "backups")],
      {
        cwd: resolve("."),
        env: { ...process.env, SURVEY_DATA_DIR: app.directory },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let error = "";
    child.stderr.on("data", (d) => (error += d));
    child.on("error", reject);
    child.on("exit", (code) => resolveExit({ code, error }));
  });
  assert.equal(exit.code, 0, exit.error);
  const backupDir = join(
    app.directory,
    "backups",
    (await readdir(join(app.directory, "backups")))[0],
  );
  const manifest = JSON.parse(
    await readFile(join(backupDir, "manifest.json"), "utf8"),
  );
  for (const [file, digest] of Object.entries(manifest.checksums))
    assert.equal(sha(await readFile(join(backupDir, file))), digest);
  const snapshot = new DatabaseSync(join(backupDir, "surveys.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    snapshot
      .prepare("SELECT status FROM responses WHERE id=?")
      .get(responseIds[0]).status,
    "paid",
  );
  assert.equal(snapshot.prepare("SELECT COUNT(*) AS n FROM drafts").get().n, 1);
  snapshot.close();
  for (const file of ["surveys.sqlite", "surveys.sqlite-wal"]) {
    const bytes = await readFile(join(app.directory, file));
    for (const sentinel of [
      "PRIVATE-DRAFT-SENTINEL",
      "PRIVATE-SURVEY-SENTINEL",
      "PRIVATE-ANSWER-SENTINEL",
      ...tokens,
    ])
      assert.ok(!bytes.includes(Buffer.from(sentinel)));
  }
});
