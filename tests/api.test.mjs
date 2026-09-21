import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import http from "node:http";
import { encryptResponse } from "../lib/envelopes.mjs";
const base = process.env.SURVEY_TEST_URL;
const run = base ? test : test.skip;
const random = () => randomBytes(32).toString("hex");
const sha = (v) => createHash("sha256").update(v).digest("hex");
run(
  "HTTP authorization, one-use invitations, ciphertext storage, and closed surveys",
  async () => {
    const admin = (await readFile("data/admin-access.txt", "utf8")).trim();
    const req = async (path, token, body, headers = {}) => {
      const r = await fetch(base + "/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, value: await r.json() };
    };
    assert.equal((await req("/admin/surveys")).status, 401);
    assert.equal((await req("/admin/surveys", random())).status, 401);
    assert.equal(
      (
        await req("/admin/surveys", admin, undefined, {
          Origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    const hostileHost = await new Promise((resolve, reject) => {
      http
        .get(
          base + "/api/config",
          { headers: { Host: "attacker.example" } },
          (r) => {
            r.resume();
            resolve(r.statusCode);
          },
        )
        .on("error", reject);
    });
    assert.equal(hostileHost, 403);
    const vault = (await req("/admin/vault", admin)).value;
    const id = random(),
      tokens = [random(), random()],
      responseIds = [random(), random()];
    const body = {
      id,
      questions: {
        iv: Buffer.alloc(12).toString("base64"),
        data: Buffer.from("ciphertext-fixture-only").toString("base64"),
      },
      adminEnvelope: await encryptResponse(vault.publicKey, id, {
        title: "Synthetic privacy sentinel 95217",
        introduction: "",
        questions: [],
        tokens: [],
        key: random(),
      }),
      invitations: tokens.map((t, i) => ({
        tokenHash: sha(t),
        responseId: responseIds[i],
      })),
    };
    assert.equal((await req("/admin/surveys", admin, body)).status, 201);
    assert.equal((await req("/invitation", random())).status, 400);
    const invitation = await req("/invitation", tokens[0]);
    assert.equal(invitation.status, 200);
    assert.equal(invitation.value.responseId, responseIds[0]);
    const answer = await encryptResponse(vault.publicKey, responseIds[0], {
      answers: { q: "Synthetic answer sentinel 72849" },
      destination: "synthetic test address",
    });
    assert.equal((await req("/respond", tokens[0], answer)).status, 201);
    assert.equal((await req("/respond", tokens[0], answer)).status, 400);
    assert.equal((await req("/respond", tokens[1], answer)).status, 400);
    assert.equal((await req("/admin/surveys", tokens[0])).status, 401);
    assert.equal(
      (
        await req(`/admin/responses/${responseIds[0]}/pay`, tokens[0], {
          destination: "x",
        })
      ).status,
      401,
    );
    assert.equal((await req("/invitation", tokens[1])).value.submitted, false);
    const stored = (await req("/admin/surveys", admin)).value;
    const response = stored.responses.find((r) => r.id === responseIds[0]);
    assert.equal(response.status, "submitted");
    assert.ok(!JSON.stringify(response).includes("Synthetic answer sentinel"));
    assert.equal(
      (await req(`/admin/surveys/${id}/close`, admin, {})).status,
      200,
    );
    const second = await encryptResponse(vault.publicKey, responseIds[1], {
      answers: { q: "closed" },
    });
    assert.equal((await req("/respond", tokens[1], second)).status, 400);
    for (const path of [
      "data/qa-surveys.sqlite",
      "data/qa-surveys.sqlite-wal",
    ]) {
      const bytes = await readFile(path);
      for (const text of [
        "Synthetic privacy sentinel 95217",
        "Synthetic answer sentinel 72849",
        ...tokens,
      ])
        assert.ok(
          !bytes.includes(Buffer.from(text)),
          `plaintext was found in ${path}`,
        );
    }
  },
);
