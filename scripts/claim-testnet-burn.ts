import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { connect, INDEXER, waitReceipt } from "../chain/ootle.ts";
import { dataPath, dataDirectory } from "../server/paths.ts";
import {
  requireBurnMaturity,
  requireRetryableClaim,
  estimateClaimFee,
} from "../chain/claim-policy.ts";
const run = promisify(execFile);
const proof = process.argv[2];
if (!proof) throw new Error("Usage: npm run funding:claim -- BURN_PROOF_JSON");
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
const journalPath = dataPath("burn-claim-journal.json");
let prior: any;
try {
  prior = JSON.parse(await readFile(journalPath, "utf8"));
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
const p = await connect();
const newAttempt = process.argv.includes("--new-attempt-after-rejection");
const proofData = JSON.parse(await readFile(resolve(proof), "utf8"));
async function requireMatureBurn() {
  const response = await fetch(INDEXER + "/epoch-manager/stats", {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Unable to verify burn maturity");
  const stats = await response.json();
  requireBurnMaturity(proofData, stats);
}
if (newAttempt) {
  if (!prior?.transaction_id) throw new Error("No recorded claim to reconcile");
  const existing = await p.getTransactionResult(prior.transaction_id);
  requireRetryableClaim(existing);
  await requireMatureBurn();
  await writeFile(
    dataPath(`burn-claim-rejected-${prior.transaction_id}.json`),
    JSON.stringify(existing, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  await rename(
    journalPath,
    dataPath(`burn-claim-journal-${prior.transaction_id}.json`),
  );
  prior = undefined;
}
if (prior) {
  if (!prior.transaction_id)
    throw new Error("Incomplete claim journal; reconcile before proceeding");
  const receipt = await waitReceipt(p, prior.transaction_id);
  await writeFile(
    dataPath("burn-claim-receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "Previously submitted burn claim is committed:",
    prior.transaction_id,
  );
} else {
  // Indexer dry runs do not perform the consensus epoch/header availability check.
  await requireMatureBurn();
  const maxEpoch = (await p.getCurrentEpoch()) + 10;
  const helper = process.env.SURVEY_CLAIM_HELPER ?? "";
  if (!helper)
    throw new Error(
      "Set SURVEY_CLAIM_HELPER to the compiled survey-testnet-claim executable (or the Linux path when SURVEY_CLAIM_WSL is set).",
    );
  async function prepare(fee: bigint, mode: string) {
    const output = dataPath(`claim-${mode}-${Date.now()}.json`);
    const args = [
      dataPath("operator.json"),
      resolve(proof),
      String(maxEpoch),
      String(fee),
      mode,
      output,
    ];
    const distro = process.env.SURVEY_CLAIM_WSL;
    if (distro) {
      const linux = args.map((arg, i) =>
        [0, 1, 5].includes(i)
          ? "/mnt/" + arg[0].toLowerCase() + arg.slice(2).replaceAll("\\", "/")
          : arg,
      );
      await run("wsl.exe", ["-d", distro, "--", helper, ...linux], {
        windowsHide: true,
      });
    } else await run(helper, args, { windowsHide: true });
    const value = JSON.parse(await readFile(output, "utf8"));
    if (value.network !== "esmeralda")
      throw new Error("Refusing a non-Esmeralda claim");
    return value;
  }
  const trial = await prepare(2_000_000n, "dry");
  const response = await fetch(INDEXER + "/transactions/dry-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: trial.transaction }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error("Claim dry run unavailable: " + (await response.text()));
  const result = await response.json();
  const fee = estimateClaimFee(result.result?.finalize);
  const prepared = await prepare(fee, "submit");
  // Exact transaction ID is persisted before network submission. A rerun only
  // queries this ID, even when the original submit response was lost.
  await writeFile(
    journalPath,
    JSON.stringify({ ...prepared, status: "prepared" }, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  const sent = await p.submitTransaction(prepared.transaction);
  if (sent.transaction_id !== prepared.transaction_id)
    throw new Error("Submitted claim ID differs from locally computed ID");
  const receipt = await waitReceipt(p, sent.transaction_id);
  await writeFile(
    dataPath("burn-claim-receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log("Esmeralda burn claim committed:", sent.transaction_id);
}
