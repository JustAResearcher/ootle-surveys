/** Consensus maturity is separate from the indexer's execution-only dry run. */
export function requireBurnMaturity(proof: any, stats: any) {
  const height = proof.claim_proof?.output_proof?.block_height;
  const epoch = proof.mined_in_epoch;
  if (
    !Number.isSafeInteger(height) ||
    height < 0 ||
    !Number.isSafeInteger(epoch) ||
    epoch < 0
  )
    throw new Error(
      "Use the complete Minotari proof, including block height and mined_in_epoch.",
    );
  if (
    !Number.isSafeInteger(stats.current_block_height) ||
    !Number.isSafeInteger(stats.current_epoch)
  )
    throw new Error("Invalid indexer maturity response");
  if (stats.current_block_height < height || stats.current_epoch <= epoch)
    throw new Error(
      `Burn is awaiting network maturity: scanned height ${stats.current_block_height}, epoch ${stats.current_epoch}; need height >= ${height} and epoch > ${epoch}. Nothing submitted.`,
    );
}

export function requireRetryableClaim(result: any) {
  // The indexer later compacts a finalized abort into its Rejected variant.
  const compact = result.result?.Rejected;
  if (
    typeof compact?.details === "string" &&
    /^Execution failure \(NotYetValid\): /.test(compact.details)
  )
    return;
  const finalized = result.result?.Finalized;
  const failure =
    finalized?.execution_result?.finalize?.result?.Reject?.ExecutionFailure;
  if (
    finalized?.final_decision?.Abort !== "ExecutionFailure" ||
    failure?.code !== "NotYetValid"
  )
    throw new Error(
      "A new attempt is only allowed after a confirmed Abort/NotYetValid result.",
    );
}

export function estimateClaimFee(finalize: any) {
  if (!finalize?.result || !("Accept" in finalize.result))
    throw new Error(
      "Burn is not claimable: " + JSON.stringify(finalize?.result),
    );
  // Claims exhaust the offered fee. Paid therefore includes overcharge.
  const cost = finalize.total_fees_required;
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error("Invalid claim fee estimate");
  const fee = (BigInt(cost) * 3n) / 2n + 1000n;
  if (fee > 2_000_000n) throw new Error("Claim fee exceeds the test-token cap");
  return fee;
}
