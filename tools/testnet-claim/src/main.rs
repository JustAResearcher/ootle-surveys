//! Offline preparation only: this tool never submits a transaction or contacts L1.
//! Network is deliberately fixed to Esmeralda. Keys are read from a local file,
//! never accepted as command-line values or printed.
use anyhow::{Context, Result, ensure};
use ootle_rs::{
    Network, TransactionRequest,
    claim_burn::{ClaimBurn, MinotariBurnClaimProof},
    key_provider::PrivateKeyProvider,
    keys::OotleSecretKey,
    provider::ProviderBuilder,
    template_types::EncryptedData,
    wallet::{NetworkWallet, OotleWallet},
};
use std::{env, fs, io::Write};
use tari_crypto::{
    keys::PublicKey,
    ristretto::{RistrettoPublicKey, RistrettoSecretKey},
    tari_utilities::hex::Hex,
};
use tari_ootle_transaction::{Epoch, TransactionEnvelope};
mod burn_conversion;

#[derive(serde::Deserialize)]
struct Operator {
    owner: String,
    view: String,
}
#[derive(serde::Deserialize)]
struct ProofFile {
    claim_proof: MinotariBurnClaimProof,
    encrypted_data: EncryptedData,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.len() == 2 && args[0] == "identity" {
        let operator: Operator = serde_json::from_slice(&fs::read(&args[1])?)?;
        let owner = RistrettoSecretKey::from_hex(&operator.owner)
            .map_err(|_| anyhow::anyhow!("Invalid owner key"))?;
        let public = RistrettoPublicKey::from_secret_key(&owner).to_hex();
        let view = RistrettoSecretKey::from_hex(&operator.view)
            .map_err(|_| anyhow::anyhow!("Invalid view key"))?;
        let wallet = OotleWallet::from(PrivateKeyProvider::new(OotleSecretKey::new(
            Network::Esmeralda,
            owner,
            view,
        )));
        println!(
            "{}",
            serde_json::json!({"network":"esmeralda","claimPublicKey":public,"receivingAddress":wallet.default_address().to_string()})
        );
        return Ok(());
    }
    ensure!(
        args.len() == 6,
        "Usage: survey-testnet-claim OPERATOR_FILE PROOF_FILE MAX_EPOCH MAX_FEE dry|submit OUTPUT_FILE"
    );
    let operator: Operator =
        serde_json::from_slice(&fs::read(&args[0])?).context("Invalid operator file")?;
    let raw = fs::read(&args[1])?;
    let shape: serde_json::Value = serde_json::from_slice(&raw)?;
    let proof: ProofFile = if shape["claim_proof"].get("output_proof").is_some() {
        let l1: tari_sidechain::CompleteClaimBurnProof =
            serde_json::from_slice(&raw).context("Invalid Minotari burn proof")?;
        ProofFile {
            claim_proof: burn_conversion::claim_proof_from_l1(&l1.claim_proof)
                .map_err(anyhow::Error::msg)?,
            encrypted_data: EncryptedData::try_from(l1.encrypted_data)
                .map_err(|_| anyhow::anyhow!("Invalid encrypted burn data"))?,
        }
    } else {
        serde_json::from_slice(&raw).context("Invalid current-protocol burn proof")?
    };
    let epoch: u64 = args[2].parse()?;
    let fee: u64 = args[3].parse()?;
    ensure!(
        fee > 0 && fee <= 2_000_000,
        "Fee cap exceeds the testnet helper limit"
    );
    ensure!(
        args[4] == "dry" || args[4] == "submit",
        "Invalid preparation mode"
    );
    let owner = RistrettoSecretKey::from_hex(&operator.owner)
        .map_err(|_| anyhow::anyhow!("Invalid operator owner key"))?;
    let view = RistrettoSecretKey::from_hex(&operator.view)
        .map_err(|_| anyhow::anyhow!("Invalid operator view key"))?;
    let keys = OotleSecretKey::new(Network::Esmeralda, owner, view);
    let wallet = OotleWallet::from(PrivateKeyProvider::new(keys));
    // Provider construction is local. ClaimBurn::prepare only uses its wallet/network.
    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect("https://ootle-indexer-a.tari.com")
        .await?;
    let (unsigned, sealer) = ClaimBurn::new(
        &provider,
        proof.claim_proof,
        proof.encrypted_data,
        Epoch(epoch),
    )
    .with_max_fee(fee)
    .prepare()
    .await?;
    let tx = TransactionRequest::default()
        .with_transaction(unsigned.with_dry_run(args[4] == "dry"))
        .build(&sealer)
        .await?;
    let id = tx.calculate_id().to_string();
    let envelope = TransactionEnvelope::encode(tx)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&args[5])?;
    file.write_all(&serde_json::to_vec_pretty(
        &serde_json::json!({"network":"esmeralda","transaction_id":id,"transaction":envelope}),
    )?)?;
    file.sync_all()?;
    println!("Prepared Esmeralda {} transaction {}", args[4], id);
    Ok(())
}
