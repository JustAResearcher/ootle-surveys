import test from "node:test";
import assert from "node:assert/strict";
import {
  requireBurnMaturity,
  requireRetryableClaim,
  estimateClaimFee,
} from "../chain/claim-policy.ts";

test("burn maturity requires both a scanned block and a later consensus epoch", () => {
  const proof = {
    claim_proof: { output_proof: { block_height: 934683 } },
    mined_in_epoch: 11683,
  };
  assert.throws(
    () =>
      requireBurnMaturity(proof, {
        current_block_height: 934609,
        current_epoch: 11682,
      }),
    /maturity/,
  );
  assert.throws(
    () =>
      requireBurnMaturity(proof, {
        current_block_height: 934700,
        current_epoch: 11683,
      }),
    /maturity/,
  );
  assert.throws(
    () =>
      requireBurnMaturity(proof, {
        current_block_height: 934682,
        current_epoch: 11684,
      }),
    /maturity/,
  );
  assert.throws(() => requireBurnMaturity(proof, {}), /Invalid/);
  assert.throws(
    () =>
      requireBurnMaturity(
        {},
        { current_block_height: 934720, current_epoch: 11684 },
      ),
    /complete/,
  );
  assert.doesNotThrow(() =>
    requireBurnMaturity(proof, {
      current_block_height: 934720,
      current_epoch: 11684,
    }),
  );
});

test("only a final NotYetValid abort permits an explicit replacement claim", () => {
  assert.doesNotThrow(() =>
    requireRetryableClaim({
      result: {
        Rejected: {
          details:
            "Execution failure (NotYetValid): Burn header not yet available",
        },
      },
    }),
  );
  assert.throws(() =>
    requireRetryableClaim({
      result: {
        Rejected: { details: "Execution failure (InvalidProof): Invalid burn" },
      },
    }),
  );
  const finalized = {
    final_decision: { Abort: "ExecutionFailure" },
    execution_result: {
      finalize: {
        result: { Reject: { ExecutionFailure: { code: "NotYetValid" } } },
      },
    },
  };
  assert.doesNotThrow(() =>
    requireRetryableClaim({ result: { Finalized: finalized } }),
  );
  assert.throws(() => requireRetryableClaim({ result: "Pending" }));
  assert.throws(() => requireRetryableClaim({}));
  assert.throws(() =>
    requireRetryableClaim({
      result: { Finalized: { ...finalized, final_decision: "Commit" } },
    }),
  );
  finalized.execution_result.finalize.result.Reject.ExecutionFailure.code =
    "InvalidProof";
  assert.throws(() =>
    requireRetryableClaim({ result: { Finalized: finalized } }),
  );
});

test("burn fee estimate excludes exhausted overpayment and enforces the cap", () => {
  const result = {
    result: { Accept: {} },
    total_fees_required: 13226,
    fee_receipt: {
      total_fees_paid: 2000000,
      total_fee_overcharge: 1986774,
      exhaust_burn: 2000000,
    },
  };
  assert.equal(estimateClaimFee(result), 20839n);
  assert.throws(
    () => estimateClaimFee({ ...result, total_fees_required: 2000000 }),
    /cap/,
  );
  assert.throws(
    () => estimateClaimFee({ ...result, total_fees_required: undefined }),
    /Invalid/,
  );
  assert.throws(
    () => estimateClaimFee({ ...result, result: { Reject: {} } }),
    /not claimable/,
  );
});
