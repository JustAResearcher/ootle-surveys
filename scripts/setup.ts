import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { generateOotleSecretKey } from "@tari-project/ootle-wasm";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { toHexStr } from "@tari-project/ootle";
import {
  connect,
  NETWORK,
  faucet,
  publish,
  createPool,
  newAddress,
  waitReceipt,
} from "../chain/ootle.ts";
await mkdir("data", { recursive: true });
const p = await connect();
async function save(value: any) {
  await writeFile("data/operator.json.tmp", JSON.stringify(value), {
    mode: 0o600,
  });
  await rename("data/operator.json.tmp", "data/operator.json");
}
let state: any;
try {
  state = JSON.parse(await readFile("data/operator.json", "utf8"));
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
if (!state.account) {
  const result = state.faucetTx
    ? { receipt: await waitReceipt(p, state.faucetTx) }
    : await faucet(p, signer, async (id) => {
        state.faucetTx = id;
        await save(state);
      });
  state.account = newAddress(result.receipt, "component_");
  await save(state);
  console.log("Test wallet funded");
}
const wallet = { signer, account: state.account, publicKey };
if (!state.template) {
  const binary = (
    await readFile(
      process.argv[2] ??
        "artifacts/private_rewards.wasm",
    )
  ).toString("base64");
  const result = state.publishTx
    ? { receipt: await waitReceipt(p, state.publishTx) }
    : await publish(p, wallet, binary, async (id) => {
        state.publishTx = id;
        await save(state);
      });
  state.template = newAddress(result.receipt, "template_");
  await save(state);
  console.log("Template published:", state.template);
}
if (!state.pool) {
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
  publishTransaction: state.publishTx,
  poolTransaction: state.poolTx,
};
await writeFile("data/deployment.json", JSON.stringify(deployment, null, 2));
console.log(JSON.stringify(deployment, null, 2));
