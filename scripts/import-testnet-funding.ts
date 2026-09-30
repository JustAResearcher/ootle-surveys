import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import {
  connect,
  NETWORK,
  INDEXER,
  newAddress,
  waitReceipt,
} from "../chain/ootle.ts";
import { prepareFundedAccount } from "../chain/funding.ts";
import { dataPath, dataDirectory } from "../server/paths.ts";
const utxo = process.argv[2];
if (!utxo) throw new Error("Usage: npm run funding:import -- utxo_...");
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
const operator = JSON.parse(await readFile(dataPath("operator.json"), "utf8"));
const p = await connect();
if (operator.account)
  throw new Error(
    "Operator already has an account; use a separate candidate directory for a testnet reset",
  );
const signer = SecretKeyWallet.fromSecretKey(
  Buffer.from(operator.owner, "hex"),
  NETWORK,
  Buffer.from(operator.view, "hex"),
);
const journalPath = dataPath("funding-import.json");
let journal: any;
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
if (journal?.transaction_id) {
  const receipt = await waitReceipt(p, journal.transaction_id);
  operator.account = newAddress(receipt, "component_");
} else {
  if (journal)
    throw new Error(
      "A previous funding submission has an unknown outcome. Reconcile it before another submission.",
    );
  const trial = await prepareFundedAccount(p, signer, utxo, 2_000_000n, true);
  const res = await fetch(INDEXER + "/transactions/dry-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: trial.envelope }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error("Funding dry run failed: " + (await res.text()));
  const estimate = await res.json();
  const f = estimate.result?.finalize;
  if (!f?.result || !("Accept" in f.result))
    throw new Error("Funding rejected: " + JSON.stringify(f?.result));
  const charged = f.fee_receipt?.total_fees_paid;
  if (!Number.isSafeInteger(charged) || charged < 0)
    throw new Error("Invalid funding fee estimate");
  const fee = (BigInt(charged) * 3n) / 2n + 1000n;
  const prepared = await prepareFundedAccount(p, signer, utxo, fee, false);
  journal = {
    status: "prepared",
    utxo,
    network: "esmeralda",
    transaction: prepared.envelope,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  const sent = await p.submitTransaction(prepared.envelope);
  journal.transaction_id = sent.transaction_id;
  journal.status = "submitted";
  await writeFile(journalPath, JSON.stringify(journal, null, 2), {
    mode: 0o600,
  });
  const receipt = await waitReceipt(p, sent.transaction_id);
  operator.account = newAddress(receipt, "component_");
  await writeFile(
    dataPath("funding-import-receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
}
await writeFile(dataPath("operator.json.tmp"), JSON.stringify(operator), {
  mode: 0o600,
});
await rename(dataPath("operator.json.tmp"), dataPath("operator.json"));
console.log("Funded Esmeralda account:", operator.account);
