import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { WasmStealthCrypto, decryptOwnedUtxo } from "@tari-project/ootle";
import {
  connect,
  NETWORK,
  pay,
  poolState,
  newAddress,
} from "../chain/ootle.ts";
const d = JSON.parse(await readFile("data/deployment.json", "utf8"));
const saved = JSON.parse(await readFile("data/operator.json", "utf8"));
const signer = SecretKeyWallet.fromSecretKey(
  Buffer.from(saved.owner, "hex"),
  NETWORK,
  Buffer.from(saved.view, "hex"),
);
const p = await connect();
const recipient = SecretKeyWallet.randomWithViewKey(NETWORK);
const wrong = SecretKeyWallet.randomWithViewKey(NETWORK);
console.log("Pool state", JSON.stringify(await poolState(p, d)));
const receipt = randomBytes(32).toString("hex");
const result = await pay(
  p,
  { signer, account: d.account, publicKey: d.publicKey },
  d,
  receipt,
  await recipient.getAddress(),
  async (id) => {
    await writeFile(
      "data/verification-pending.json",
      JSON.stringify({ id, receipt }),
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
  template: d.template,
  pool: d.pool,
  transaction: result.id,
  utxo: id,
  recipientRecoveredMicroTari: own.value.toString(),
  wrongRecipientCouldDecrypt: other !== null,
  verifiedAt: new Date().toISOString(),
};
await writeFile(
  "data/live-verification.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
