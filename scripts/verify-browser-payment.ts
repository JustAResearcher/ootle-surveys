import { readFile, writeFile } from "node:fs/promises";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { WasmStealthCrypto, decryptOwnedUtxo } from "@tari-project/ootle";
import { connect, NETWORK, newAddress, poolState } from "../chain/ootle.ts";
import { dataPath } from "../server/paths.ts";
const base = process.env.SURVEY_TEST_URL ?? "http://127.0.0.1:4183";
const token = (await readFile(dataPath("admin-access.txt"), "utf8")).trim();
const data = await (
  await fetch(base + "/api/admin/surveys", {
    headers: { Authorization: "Bearer " + token },
  })
).json();
const row = data.responses.find((r: any) => r.status === "paid");
if (!row) throw new Error("No paid browser response");
const p = await connect();
const d = JSON.parse(await readFile(dataPath("deployment.json"), "utf8"));
const saved = JSON.parse(await readFile(dataPath("qa-recipient.json"), "utf8"));
const signer = SecretKeyWallet.fromSecretKey(
  Buffer.from(saved.owner, "hex"),
  NETWORK,
  Buffer.from(saved.view, "hex"),
);
const receipt = await p.getTransactionResult(row.transaction_id);
const utxo = newAddress(receipt, "utxo_");
const state = await p.getSubstate(utxo);
const crypt = new WasmStealthCrypto(NETWORK);
const owned = await decryptOwnedUtxo(
  crypt,
  await signer.getViewSecret(),
  state,
  utxo,
);
if (owned?.value !== 1_000_000n)
  throw new Error("Browser recipient did not receive exact reward");
const unrelated = SecretKeyWallet.randomWithViewKey(NETWORK);
const wrong = await decryptOwnedUtxo(
  crypt,
  await unrelated.getViewSecret(),
  state,
  utxo,
);
if (wrong !== null)
  throw new Error("Unrelated wallet decrypted the browser payout");
const before = await poolState(p, d);
const duplicate = await (
  await fetch(base + `/api/admin/responses/${row.id}/pay`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ destination: saved.address }),
  })
).json();
const after = await poolState(p, d);
if (duplicate.transaction !== row.transaction_id || before.paid !== after.paid)
  throw new Error("Duplicate approval was not idempotent");
const evidence = {
  flow: "browser create -> encrypted invitation -> encrypted submission -> organizer approval -> stealth payout",
  network: "esmeralda",
  protocol: "0.42.0",
  template: d.template,
  pool: d.pool,
  transaction: row.transaction_id,
  utxo,
  recipientRecoveredMicroTari: owned.value.toString(),
  wrongRecipientCouldDecrypt: false,
  duplicateApprovalCreatedAnotherPayment: false,
  verifiedAt: new Date().toISOString(),
};
await writeFile(
  dataPath("browser-payment-verification.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
