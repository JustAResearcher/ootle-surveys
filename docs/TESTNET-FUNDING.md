# Esmeralda funding and reset recovery

Ootle 0.42 reset the public testnet. Old accounts, templates, pools and transaction
references no longer represent spendable state. The public L2 faucet was empty
when checked on September 30, 2026. Setup therefore requires funded testnet outputs;
it no longer assumes that a faucet can fund an account.

These commands are deliberately restricted to Esmeralda test tokens. A fresh
installation needs at least 120 tTARI to deploy and fund its 100 tTARI reward pool.

## Prepare an operator

Run `npm run setup:testnet` once. It saves the operator keys privately and prints
the public Ootle receiving address and claim public key. Keep `data/operator.json`
private. The command exits with code 2 until the operator has a funded account.

For an existing installation affected by a reset, first run `npm run backup`, then:

```sh
npm run setup:testnet -- --prepare-reset
```

This creates a dated candidate directory under `data/`, retaining the operator's
keys but dropping obsolete chain addresses. It preserves the active deployment,
encrypted questionnaire database, organizer code and vault. Set `SURVEY_DATA_DIR`
to that candidate directory for every funding, setup and verification command below.
On PowerShell, use `$env:SURVEY_DATA_DIR = 'C:\path\to\data\reset-YYYYMMDD'`.

## Obtain test tokens

Receive Esmeralda tTARI at the printed Ootle address, or use the L1 burn-and-claim
route. On September 30 the community [L1 testnet faucet](https://testnet-faucet.supportxtm.com/)
provided tXTM to an Esmeralda Minotari wallet. Its availability and limits can change.
This faucet takes a **Minotari Esmeralda address**, not an Ootle address.

Using an isolated Esmeralda Minotari wallet, burn test tokens to the exact printed
claim public key and export the complete JSON burn proof. The reference migration
used 200 tXTM. Preserve the burn transaction ID and proof; do not burn again just
because the proof is not mature yet. See Tari's [burn guide](https://ootle.tari.com/guides/burn-minotari/).

Build the included claim helper with Rust 1.96 or newer:

```sh
cargo build --locked --manifest-path tools/testnet-claim/Cargo.toml
```

Set `SURVEY_CLAIM_HELPER` to the resulting `survey-testnet-claim` executable. For a
Linux binary run from Windows, set `SURVEY_CLAIM_WSL` to the installed WSL distro
and use the binary's absolute Linux path. The helper reads keys from a file and
prepares/signs transactions locally; it never sends keys to the indexer.

```sh
npm run funding:claim -- /path/to/complete-burn-proof.json
```

The command checks the indexer's scanned height and waits for an epoch later than
the burn's `mined_in_epoch` before allowing submission. It exits without submitting
if the proof is not ready. A dry run alone does not validate this consensus condition.
The claim pays its own fee from the burned funds, bounded to 2 tTARI. Its exact
transaction ID is saved before submission. Rerunning normally only reconciles it.

A confirmed `Abort / ExecutionFailure / NotYetValid` may be retried explicitly once
the maturity check passes, using `--new-attempt-after-rejection`. This archives the
prior transaction and result. It cannot replace pending, unknown, committed, or
otherwise rejected claims. Never remove journals to force a retry.

## Fund and deploy

Find the live, recipient-owned `utxo_...` in the claim receipt or incoming transfer.
The import command independently decrypts it with the operator's view key and
checks the network, resource and balance before creating an account:

```sh
npm run funding:import -- utxo_...
npm run setup:testnet
npm run verify:testnet
```

Import uses the output itself to fund account creation and fees. It dry-runs first,
journals the signed envelope before submitting, and refuses to repeat an unknown
submission. Setup records attempted publication/pool creation before broadcast and
reconciles returned IDs. Investigate unknown outcomes; do not delete attempt flags.

Verification makes one real 1 tTARI payout to a fresh wallet, proves exact recipient
decryption, and verifies that an unrelated wallet cannot decrypt it. Its recipient
keys and submission journal stay in the private data directory. Re-running a
recorded verification checks the existing transaction rather than paying again.

For a reset, only after verifying the candidate, stop the server, back up again,
and replace the active `operator.json` and `deployment.json` together with the
candidate versions. Preserve the existing SQLite database, organizer code and vault.
Restart and verify the available pool balance. Previously paid records remain
historical; a reset does not authorize paying them again. Uncertain old payments
require manual reconciliation before further action.

The native helper includes an attributed BSD-3-Clause adapter from Tari 0.42.
See `tools/testnet-claim/NOTICE` and `LICENSE-TARI`.
