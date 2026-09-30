import test from "node:test";
import assert from "node:assert/strict";
import {
  Network,
  WasmStealthCrypto,
  createOutput,
  TARI_RESOURCE_ADDRESS,
} from "@tari-project/ootle";
import { SecretKeyWallet } from "@tari-project/ootle-secret-key-wallet";
import { prepareFundedAccount } from "../chain/funding.ts";
import { newAddress } from "../chain/ootle.ts";

test("funding bootstrap uses real owned-output cryptography and rejects another owner", async () => {
  const owner = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);
  const other = SecretKeyWallet.randomWithViewKey(Network.Esmeralda);
  const crypto = new WasmStealthCrypto(Network.Esmeralda);
  const mint = await crypto.generateOutputsStatement(
    [
      createOutput({
        destination: await owner.getAddress(),
        amount: 150_000_000n,
        resourceAddress: TARI_RESOURCE_ADDRESS,
      }),
    ],
    null,
  );
  const out = JSON.parse(mint.statement.statementJson).outputs[0];
  const id = `utxo_${TARI_RESOURCE_ADDRESS.slice(9)}_${out.output.commitment}`;
  const state = {
    version: 0,
    substate: {
      Utxo: {
        is_frozen: false,
        output: {
          output: {
            public_nonce: out.output.sender_public_nonce,
            encrypted_data: out.output.encrypted_data,
          },
        },
      },
    },
  };
  const provider = {
    network: () => Network.Esmeralda,
    getCurrentEpoch: async () => 100,
    getSubstate: async (requested) => {
      assert.equal(requested, id);
      return state;
    },
  };
  const result = await prepareFundedAccount(provider, owner, id, 10000n, true);
  assert.equal(result.value, 150_000_000n);
  assert.equal(typeof result.envelope, "string");
  assert.ok(result.envelope.length > 100);
  await assert.rejects(
    prepareFundedAccount(provider, other, id, 10000n, true),
    /not spendable/,
  );
  await assert.rejects(
    prepareFundedAccount(
      { ...provider, network: () => Network.MainNet },
      owner,
      id,
      10000n,
      true,
    ),
    /Esmeralda-only/,
  );
  await assert.rejects(
    prepareFundedAccount(provider, owner, id, 2_000_001n, true),
    /limits/,
  );
});

test("new substate detection accepts u64 version strings without mistaking existing substates", () => {
  const diff = {
    up_substates: [
      ["component_invalid", { version: null }],
      ["component_existing", { version: "18446744073709551615" }],
      ["component_new", { version: "0" }],
    ],
  };
  const receipt = {
    result: {
      Finalized: {
        execution_result: { finalize: { result: { Accept: diff } } },
      },
    },
  };
  assert.equal(newAddress(receipt, "component_"), "component_new");
});
