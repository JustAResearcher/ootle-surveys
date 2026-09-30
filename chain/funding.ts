import {
  TransactionBuilder,
  WasmStealthCrypto,
  StealthInput,
  StealthTransferStatement,
  decryptOwnedUtxo,
  parseSubstateUtxo,
  signBalanceProof,
  stealthTransferInstruction,
  generateSealKeypair,
  serializeUnsignedTx,
  signTransaction,
  sealTransaction,
  amountLiteral,
  resolveMaxEpoch,
  toHexStr,
  fromHexStr,
  TARI_RESOURCE_ADDRESS,
} from "@tari-project/ootle";
import type { Signer } from "@tari-project/ootle";
import type { IndexerProvider } from "@tari-project/ootle-indexer";
import { NETWORK } from "./ootle.ts";

/** Turn an owned testnet stealth output into a funded account in one atomic fee intent.
 * Account creation/deposit precedes pay_fee so no faucet or pre-funded fee account is needed.
 * The SDK produces all cryptographic statements/signatures; no custom cryptography is used.
 */
export async function prepareFundedAccount(
  p: IndexerProvider,
  signer: Signer,
  utxo: string,
  fee: bigint,
  dryRun: boolean,
) {
  if (p.network() !== NETWORK)
    throw new Error("Funding bootstrap is Esmeralda-only");
  if (
    !utxo.startsWith(`utxo_${TARI_RESOURCE_ADDRESS.slice("resource_".length)}_`)
  )
    throw new Error("A native TARI stealth output is required");
  if (!signer.getViewSecret || !signer.addStealthSignature)
    throw new Error("A local owner/view signer is required");
  const crypto = new WasmStealthCrypto(NETWORK);
  const state = await p.getSubstate(utxo);
  const owned = await decryptOwnedUtxo(
    crypto,
    await signer.getViewSecret(),
    state,
    utxo,
  );
  const parsed = parseSubstateUtxo(state, utxo);
  if (!owned || !parsed)
    throw new Error("Funding output is not spendable by this operator");
  if (fee <= 0n || fee > 2_000_000n || owned.value <= fee)
    throw new Error("Funding output or fee is outside the bootstrap limits");
  const publicKey = await signer.getPublicKey();
  const input = await crypto.buildInputsStatement(
    [new StealthInput(parsed.commitment)],
    0n,
  );
  const { statement: output, outputMask } =
    await crypto.generateOutputsStatement([], {
      amount: owned.value,
      receiver: publicKey,
    });
  const proof = await signBalanceProof(
    crypto,
    owned.mask,
    outputMask,
    input,
    output,
  );
  const statement = new StealthTransferStatement(input, output, proof);
  await crypto.validateTransfer(statement);
  const unsigned = new TransactionBuilder(NETWORK, await resolveMaxEpoch(p))
    .withInputs([{ substate_id: utxo, version: null, is_write: true }])
    .withFeeInstructionsBuilder((b) =>
      b
        .addInstruction(
          stealthTransferInstruction(
            {
              resourceAddress: TARI_RESOURCE_ADDRESS,
              revealedInputBucket: null,
              statement,
            },
            (name) => b.resolveWorkspaceOffsetId(name),
          ),
        )
        .saveVar("funding")
        .createAccount(toHexStr(publicKey))
        .saveVar("account")
        .callMethod({ fromWorkspace: "account", methodName: "deposit" }, [
          { Workspace: "funding" },
        ])
        .callMethod({ fromWorkspace: "account", methodName: "pay_fee" }, [
          amountLiteral(fee),
        ]),
    )
    .buildUnsignedTransaction();
  unsigned.dry_run = dryRun;
  const seal = generateSealKeypair();
  const signature = await signer.addStealthSignature(
    serializeUnsignedTx(unsigned),
    fromHexStr(parsed.body.public_nonce),
    seal.public_key,
    { crypto },
  );
  const additional: Signer = {
    getAddress: () => signer.getAddress(),
    getPublicKey: () => signer.getPublicKey(),
    signTransaction: async () => [signature],
  };
  const envelope = sealTransaction(
    await signTransaction([signer, additional], unsigned, seal),
  );
  return { envelope, value: owned.value };
}
