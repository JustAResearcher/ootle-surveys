import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { WasmStealthCrypto, decryptOwnedUtxo } from "@tari-project/ootle";
import { generateOotleSecretKey } from "@tari-project/ootle-wasm";
import {
  connect,
  NETWORK,
  pay,
  poolState,
  newAddress,
  waitReceipt,
} from "../chain/ootle.ts";
import { dataPath } from "../server/paths.ts";
const d = JSON.parse(await readFile(dataPath("deployment.json"), "utf8"));
const saved = JSON.parse(await readFile(dataPath("operator.json"), "utf8"));
const signer = SecretKeyWallet.fromSecretKey(
  Buffer.from(saved.owner, "hex"),
  NETWORK,
  Buffer.from(saved.view, "hex"),
);
const p = await connect();
let pending: any;
try {
  pending = JSON.parse(
    await readFile(dataPath("verification-pending.json"), "utf8"),
  );
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
if (pending && pending.pool !== d.pool)
  throw new Error(
    "Verification journal belongs to a different pool; use a separate data directory.",
  );
if (pending && !pending.id)
  throw new Error(
    "Verification has an unknown submission outcome. Reconcile before another payout.",
  );
const keys = pending ? null : generateOotleSecretKey();
const recipient = SecretKeyWallet.fromSecretKey(
  pending ? Buffer.from(pending.owner, "hex") : keys!.owner_key,
  NETWORK,
  pending ? Buffer.from(pending.view, "hex") : keys!.view_key,
);
const wrong = SecretKeyWallet.randomWithViewKey(NETWORK);
console.log("Pool state", JSON.stringify(await poolState(p, d)));
const receipt = pending?.receipt ?? randomBytes(32).toString("hex");
if (!pending) {
  pending = {
    pool: d.pool,
    receipt,
    owner: Buffer.from(keys!.owner_key).toString("hex"),
    view: Buffer.from(keys!.view_key).toString("hex"),
  };
  await writeFile(
    dataPath("verification-pending.json"),
    JSON.stringify(pending),
    { flag: "wx", mode: 0o600 },
  );
}
const result = pending.id
  ? { id: pending.id, receipt: await waitReceipt(p, pending.id) }
  : await pay(
      p,
      { signer, account: d.account, publicKey: d.publicKey },
      d,
      receipt,
      await recipient.getAddress(),
      async (id) => {
        await writeFile(
          dataPath("verification-pending.json"),
          JSON.stringify({ ...pending, id }),
          { mode: 0o600 },
        );
      },
    );
const id = newAddress(result.receipt, "utxo_");
const state = await p.getSubstate(id);
const crypt = new WasmStealthCrypto(NETWORK);
const own = await decryptOwnedUtxo(
  crypt,
  await recipient.getViewSecret(),
  state,
  id,
);
const other = await decryptOwnedUtxo(
  crypt,
  await wrong.getViewSecret(),
  state,
  id,
);
if (!own || own.value !== 1_000_000n || other !== null)
  throw new Error("Recipient privacy/value verification failed");
const evidence = {
  network: "esmeralda",
  protocol: "0.42.0",
  template: d.template,
  pool: d.pool,
  transaction: result.id,
  utxo: id,
  recipientRecoveredMicroTari: own.value.toString(),
  wrongRecipientCouldDecrypt: other !== null,
  verifiedAt: new Date().toISOString(),
};
await writeFile(
  dataPath("live-verification.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
