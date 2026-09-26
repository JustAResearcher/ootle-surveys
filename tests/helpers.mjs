import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { generateOotleSecretKey } from "@tari-project/ootle-wasm";
const random = () => randomBytes(32).toString("hex");
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
const close = (server) => new Promise((resolve) => server.close(resolve));
export async function startTestApp({ live = false, publicOrigin } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "ootle-surveys-qa-"));
  const state = {
    balance: "3000000",
    receipts: [],
    epoch: 100,
    closed: false,
    offline: false,
    posts: 0,
  };
  const deployment = {
    template: "template_" + random(),
    pool: "component_" + random(),
    account: "component_" + random(),
    publicKey: random(),
    expiresEpoch: 200,
    reward: "1000000",
  };
  const vaultHex = random();
  const indexer = http.createServer((req, res) => {
    if (req.method !== "GET") state.posts++;
    if (state.offline) {
      res.writeHead(503);
      res.end("Synthetic indexer unavailable");
      return;
    }
    const path = new URL(req.url, "http://localhost").pathname;
    let body = {};
    if (path === "/epoch-manager/stats") body = { current_epoch: state.epoch };
    else if (path === "/substates/" + deployment.pool)
      body = {
        substate: {
          Component: {
            header: { template_address: deployment.template.slice(9) },
            body: {
              state: [
                { value: { hex: vaultHex } },
                null,
                null,
                deployment.account,
                "1000000",
                200,
                state.receipts,
                state.closed,
              ],
            },
          },
        },
      };
    else if (path === "/substates/vault_" + vaultHex)
      body = {
        substate: {
          Vault: {
            resource_container: { Stealth: { revealed_amount: state.balance } },
          },
        },
      };
    else if (path.startsWith("/transactions/")) body = { result: "Pending" };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  });
  const indexerPort = await listen(indexer);
  const reserving = http.createServer();
  const port = await listen(reserving);
  await close(reserving);
  if (live) {
    for (const file of ["operator.json", "deployment.json"])
      await copyFile(resolve("data", file), join(directory, file));
  } else {
    const k = generateOotleSecretKey();
    await writeFile(
      join(directory, "operator.json"),
      JSON.stringify({
        owner: Buffer.from(k.owner_key).toString("hex"),
        view: Buffer.from(k.view_key).toString("hex"),
      }),
    );
    await writeFile(
      join(directory, "deployment.json"),
      JSON.stringify(deployment),
    );
  }
  let logs = "";
  const processHandle = spawn(
    process.execPath,
    ["--experimental-wasm-modules", "--import", "tsx", "server/index.ts"],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        SURVEY_DATA_DIR: directory,
        SURVEY_DB_FILE: join(directory, "surveys.sqlite"),
        SURVEY_PORT: String(port),
        SURVEY_PUBLIC_ORIGIN: publicOrigin ?? `http://127.0.0.1:${port}`,
        SURVEY_INDEXER_URL: live
          ? "https://ootle-indexer-a.tari.com"
          : `http://127.0.0.1:${indexerPort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processHandle.stdout.on("data", (d) => {
    logs += d;
  });
  processHandle.stderr.on("data", (d) => {
    logs += d;
  });
  const base = `http://127.0.0.1:${port}`;
  async function stop(preserve = false) {
    if (processHandle.exitCode === null) {
      const exited = new Promise((resolve) =>
        processHandle.once("exit", resolve),
      );
      processHandle.kill();
      await exited;
    }
    await close(indexer);
    if (preserve) return;
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
  try {
    const deadline = Date.now() + 15000;
    while (true) {
      try {
        if ((await fetch(base + "/api/health")).ok) break;
      } catch {}
      if (Date.now() > deadline || processHandle.exitCode !== null)
        throw new Error("QA app failed to start: " + logs);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const admin = (
      await readFile(join(directory, "admin-access.txt"), "utf8")
    ).trim();
    const request = async (path, token = admin, body, headers = {}) => {
      const response = await fetch(base + "/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, value: await response.json() };
    };
    return { directory, state, deployment, admin, base, request, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
