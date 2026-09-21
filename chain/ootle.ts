import {
  AccountInvokeBuilder,
  TransactionBuilder,
  Network,
  amountLiteral,
  publicKeyLiteral,
  componentAddressLiteral,
  resourceAddressLiteral,
  intLiteral,
  literalArg,
  getVaultIdsForAccount,
  resolveMaxEpoch,
  signTransaction,
  sealTransaction,
  TARI_RESOURCE_ADDRESS,
  XTR_FAUCET_COMPONENT_ADDRESS,
  XTR_FAUCET_VAULT_ADDRESS,
  XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
  toHexStr,
  WasmStealthCrypto,
  Mask,
  createOutput,
  signBalanceProof,
  StealthTransferStatement,
} from "@tari-project/ootle";
import type { Signer } from "@tari-project/ootle";
import type { UnsignedTransactionV1 } from "@tari-project/ootle-ts-bindings";
import { IndexerProvider } from "@tari-project/ootle-indexer";
export const NETWORK = Network.Esmeralda,
  INDEXER = "https://ootle-indexer-a.tari.com",
  REWARD = 1_000_000n;
export type Wallet = { signer: Signer; account: string; publicKey: string };
export type Deployment = {
  template: string;
  pool: string;
  account: string;
  publicKey: string;
  expiresEpoch: number;
  reward: string;
};
export const connect = () =>
  IndexerProvider.connect({ url: INDEXER, network: NETWORK });
export async function inputs(p: IndexerProvider, account: string) {
  return [account, ...(await getVaultIdsForAccount(p, account))].map(
    (substate_id) => ({ substate_id, version: null }),
  );
}
export async function waitReceipt(p: IndexerProvider, id: string) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const r = await p.getTransactionResult(id);
    if (r.result !== "Pending") {
      const f = (r.result as any).Finalized;
      if (
        f?.final_decision === "Commit" &&
        f.execution_result?.finalize?.result?.Accept
      )
        return r;
      throw new Error(
        `Transaction did not commit: ${JSON.stringify(f?.execution_result?.finalize?.result ?? f?.final_decision)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    "Transaction is still pending. Check its existing ID; do not resubmit.",
  );
}
export function newAddress(receipt: any, prefix: string) {
  const diff =
    receipt.result?.Finalized?.execution_result?.finalize?.result?.Accept;
  const found = diff?.up_substates?.find(
    ([id, s]: [string, any]) => id.startsWith(prefix) && s.version === 0,
  );
  if (!found) throw new Error("Created address missing: " + prefix);
  return found[0] as string;
}
export async function transact(
  p: IndexerProvider,
  signer: Signer,
  build: (fee: bigint) => Promise<UnsignedTransactionV1>,
  record?: (id: string) => void | Promise<void>,
  cap = 5_000_000n,
) {
  const trial = await build(cap);
  const env = sealTransaction(
    await signTransaction([signer], { ...trial, dry_run: true }),
  );
  const response = await fetch(INDEXER + "/transactions/dry-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: env }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("Fee estimation unavailable");
  const estimate = await response.json();
  const f = estimate.result?.finalize;
  if (!f?.result || !("Accept" in f.result))
    throw new Error("Transaction rejected: " + JSON.stringify(f?.result));
  const paid = f.fee_receipt?.total_fees_paid;
  if (!Number.isSafeInteger(paid) || paid < 0)
    throw new Error("Invalid fee estimate");
  const fee = (BigInt(paid) * 3n) / 2n + 1000n;
  if (fee > cap)
    throw new Error("Fee estimate exceeds the configured test-token cap");
  const signed = sealTransaction(
    await signTransaction([signer], await build(fee)),
  );
  // This call is never retried automatically. Persist the ID as soon as returned.
  const result = await p.submitTransaction(signed);
  await record?.(result.transaction_id);
  return {
    id: result.transaction_id,
    receipt: await waitReceipt(p, result.transaction_id),
    fee: fee.toString(),
  };
}
export async function faucet(
  p: IndexerProvider,
  signer: Signer,
  record?: (id: string) => void | Promise<void>,
) {
  const key = toHexStr(await signer.getPublicKey());
  return transact(
    p,
    signer,
    async (fee) =>
      new TransactionBuilder(NETWORK, await resolveMaxEpoch(p))
        .withFeeInstructionsBuilder((b) =>
          b
            .createAccount(key)
            .saveVar("account")
            .callMethod(
              {
                componentAddress: XTR_FAUCET_COMPONENT_ADDRESS,
                methodName: "take",
              },
              [{ Workspace: "account" }],
            )
            .callMethod({ fromWorkspace: "account", methodName: "pay_fee" }, [
              amountLiteral(fee),
            ]),
        )
        .withInputs(
          [
            XTR_FAUCET_COMPONENT_ADDRESS,
            XTR_FAUCET_VAULT_ADDRESS,
            XTR_FAUCET_CLAIM_RESOURCE_ADDRESS,
          ].map((substate_id) => ({ substate_id, version: null })),
        )
        .buildUnsignedTransaction(),
    record,
  );
}
export async function publish(
  p: IndexerProvider,
  w: Wallet,
  binary: string,
  record?: (id: string) => void | Promise<void>,
) {
  const ins = await inputs(p, w.account);
  return transact(
    p,
    w.signer,
    async (fee) =>
      new AccountInvokeBuilder(NETWORK, await resolveMaxEpoch(p))
        .withInputs(ins)
        .feeTransactionPayFromComponent(w.account, fee)
        .publishTemplate(w.account, binary)
        .build(),
    record,
    20_000_000n,
  );
}
export async function createPool(
  p: IndexerProvider,
  w: Wallet,
  template: string,
  budget: bigint,
  expiry: number,
  record?: (id: string) => void | Promise<void>,
) {
  const ins = await inputs(p, w.account);
  return transact(
    p,
    w.signer,
    async (fee) =>
      new TransactionBuilder(NETWORK, await resolveMaxEpoch(p))
        .withInputs(ins)
        .feeTransactionPayFromComponent(w.account, fee)
        .callMethod({ componentAddress: w.account, methodName: "withdraw" }, [
          resourceAddressLiteral(TARI_RESOURCE_ADDRESS),
          amountLiteral(budget),
        ])
        .saveVar("funds")
        .callFunction({ templateAddress: template, functionName: "new" }, [
          { Workspace: "funds" },
          publicKeyLiteral(w.publicKey),
          componentAddressLiteral(w.account),
          intLiteral(REWARD),
          intLiteral(BigInt(expiry)),
        ])
        .buildUnsignedTransaction(),
    record,
  );
}
export async function poolState(p: IndexerProvider, d: Deployment) {
  const r = await p.getSubstate(d.pool);
  const c = (r.substate as any).Component;
  if (!c || c.header.template_address !== d.template.replace("template_", ""))
    throw new Error("Pool template mismatch");
  const s = c.body.state;
  if (!Array.isArray(s) || s.length !== 8)
    throw new Error("Unexpected reward pool state");
  const v = s[0].value?.hex ?? s[0].hex;
  return { vault: "vault_" + v, paid: s[6].length, closed: !!s[7], raw: s };
}
export async function pay(
  p: IndexerProvider,
  w: Wallet,
  d: Deployment,
  receipt: string,
  destination: string,
  record?: (id: string) => void | Promise<void>,
) {
  const state = await poolState(p, d);
  const crypt = new WasmStealthCrypto(NETWORK);
  const { statement: outputs, outputMask } =
    await crypt.generateOutputsStatement(
      [
        createOutput({
          destination,
          amount: REWARD,
          resourceAddress: TARI_RESOURCE_ADDRESS,
        }),
      ],
      0n,
    );
  const input = await crypt.buildInputsStatement([], REWARD);
  const proof = await signBalanceProof(
    crypt,
    Mask.zero(),
    outputMask,
    input,
    outputs,
  );
  const statement = new StealthTransferStatement(
    input,
    outputs,
    proof,
  ).toCompactJson();
  const ins = [
    ...(await inputs(p, w.account)),
    { substate_id: d.pool, version: null },
    { substate_id: state.vault, version: null },
  ];
  return transact(
    p,
    w.signer,
    async (fee) =>
      new TransactionBuilder(NETWORK, await resolveMaxEpoch(p))
        .withInputs(ins)
        .feeTransactionPayFromComponent(w.account, fee)
        .callMethod({ componentAddress: d.pool, methodName: "pay_json" }, [
          literalArg(receipt),
          literalArg(statement),
        ])
        .buildUnsignedTransaction(),
    record,
  );
}
