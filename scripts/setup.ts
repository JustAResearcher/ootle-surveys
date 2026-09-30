import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { generateOotleSecretKey } from "@tari-project/ootle-wasm";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { toHexStr } from "@tari-project/ootle";
import { join } from "node:path";
import {
  connect,
  NETWORK,
  publish,
  createPool,
  newAddress,
  waitReceipt,
  accountBalance,
} from "../chain/ootle.ts";
import { dataDirectory, dataPath } from "../server/paths.ts";
async function main() {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const p = await connect();
  async function save(value: any) {
    await writeFile(dataPath("operator.json.tmp"), JSON.stringify(value), {
      mode: 0o600,
    });
    await rename(dataPath("operator.json.tmp"), dataPath("operator.json"));
  }
  let state: any;
  try {
    state = JSON.parse(await readFile(dataPath("operator.json"), "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    const k = generateOotleSecretKey();
    state = { owner: toHexStr(k.owner_key), view: toHexStr(k.view_key) };
    await save(state);
  }
  const signer = SecretKeyWallet.fromSecretKey(
    Buffer.from(state.owner, "hex"),
    NETWORK,
    Buffer.from(state.view, "hex"),
  );
  const publicKey = toHexStr(await signer.getPublicKey());
  const receivingAddress = await signer.getAddress();
  if (process.argv.includes("--prepare-reset")) {
    const candidate = join(
      dataDirectory,
      "reset-" + new Date().toISOString().slice(0, 10).replaceAll("-", ""),
    );
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    const candidateFile = join(candidate, "operator.json");
    try {
      await writeFile(
        candidateFile,
        JSON.stringify({
          owner: state.owner,
          view: state.view,
          network: "esmeralda",
          protocol: "0.42.0",
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      const existing = JSON.parse(await readFile(candidateFile, "utf8"));
      if (existing.owner !== state.owner || existing.view !== state.view)
        throw new Error(
          "The existing reset candidate belongs to a different operator. Choose a separate data directory; nothing was overwritten.",
        );
    }
    console.log(
      JSON.stringify(
        {
          status: "reset_candidate_prepared",
          directory: candidate,
          network: "esmeralda",
          receivingAddress,
          claimPublicKey: publicKey,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!state.account) {
    console.log(
      JSON.stringify(
        {
          status: "needs_testnet_funding",
          network: "esmeralda",
          receivingAddress,
          claimPublicKey: publicKey,
          instructions:
            "The public faucet is empty. Burn Esmeralda Minotari to claimPublicKey and claim it, or receive tTARI at receivingAddress. Then use npm run funding:import -- utxo_... to create a funded account.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }
  try {
    await p.getSubstate(state.account);
  } catch (e: any) {
    if (/404|not found/i.test(e.message))
      throw new Error(
        "The recorded operator account is missing on this testnet. Prepare a separate migration directory with npm run setup:testnet -- --prepare-reset. Existing wallet keys and survey data have been preserved.",
      );
    throw e;
  }
  for (const field of ["template", "pool"])
    if (state[field]) {
      try {
        await p.getSubstate(state[field]);
      } catch (e: any) {
        if (/404|not found/i.test(e.message))
          throw new Error(
            `The recorded ${field} is missing after a testnet reset. Use --prepare-reset; old transaction IDs must not be reused.`,
          );
        throw e;
      }
    }
  if (!state.pool && (await accountBalance(p, state.account)) < 120_000_000n)
    throw new Error(
      "At least 120 tTARI is required for the 100 tTARI pool and deployment fee reserve. Fund the operator before publishing.",
    );
  const wallet = { signer, account: state.account, publicKey };
  if (!state.template) {
    if (state.publishAttempted && !state.publishTx)
      throw new Error(
        "Template submission outcome is unknown. Reconcile it before another publication.",
      );
    const binary = (
      await readFile(process.argv[2] ?? "artifacts/private_rewards.wasm")
    ).toString("base64");
    const result = state.publishTx
      ? { receipt: await waitReceipt(p, state.publishTx) }
      : await publish(
          p,
          wallet,
          binary,
          async (id) => {
            state.publishTx = id;
            await save(state);
          },
          async () => {
            state.publishAttempted = true;
            await save(state);
          },
        );
    state.template = newAddress(result.receipt, "template_");
    await save(state);
    console.log("Template published:", state.template);
  }
  if (!state.pool) {
    if (state.poolAttempted && !state.poolTx)
      throw new Error(
        "Pool submission outcome is unknown. Reconcile it before another creation.",
      );
    state.expiresEpoch ??= (await p.getCurrentEpoch()) + 1440;
    await save(state);
    const result = state.poolTx
      ? { receipt: await waitReceipt(p, state.poolTx) }
      : await createPool(
          p,
          wallet,
          state.template,
          100_000_000n,
          state.expiresEpoch,
          async (id) => {
            state.poolTx = id;
            await save(state);
          },
          async () => {
            state.poolAttempted = true;
            await save(state);
          },
        );
    state.pool = newAddress(result.receipt, "component_");
    await save(state);
  }
  const deployment = {
    template: state.template,
    pool: state.pool,
    account: state.account,
    publicKey,
    expiresEpoch: state.expiresEpoch,
    reward: "1000000",
    funded: "100000000",
    network: "esmeralda",
    protocol: "0.42.0",
    publishTransaction: state.publishTx,
    poolTransaction: state.poolTx,
  };
  await writeFile(
    dataPath("deployment.json"),
    JSON.stringify(deployment, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(deployment, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
