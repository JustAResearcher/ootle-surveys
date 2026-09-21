use tari_template_lib::prelude::*;

#[template]
mod rewards {
    use super::*;
    use std::collections::BTreeSet;

    /// A generic reward pool. It has no questionnaire, response, identity, or
    /// medical metadata. A trusted distributor attests participation off-chain.
    pub struct PrivateRewards {
        funds: Vault,
        sponsor: RistrettoPublicKeyBytes,
        distributor: RistrettoPublicKeyBytes,
        refund_account: ComponentAddress,
        reward: Amount,
        closes_epoch: u64,
        receipts: BTreeSet<String>,
        closed: bool,
    }

    impl PrivateRewards {
        /// JSON transport for clients whose ABI encoder cannot yet encode the
        /// native statement struct. It calls the identical checked payout path.
        pub fn pay_json(&mut self, receipt: String, transfer_json: String) {
            assert!(transfer_json.len() <= 32_768,"Transfer statement too large");
            let transfer: StealthTransferStatement = serde_json::from_str(&transfer_json).expect("Invalid transfer statement");
            self.pay(receipt,transfer);
        }

        pub fn new(funding: Bucket, distributor: RistrettoPublicKeyBytes,
            refund_account: ComponentAddress, reward: u64, closes_epoch: u64) -> Component<Self> {
            assert_eq!(funding.resource_address(), TARI_TOKEN, "TARI funding required");
            assert!(reward > 0, "Reward must be positive");
            let amount=Amount::from(reward);
            assert!(funding.amount() >= amount, "Insufficient funding");
            assert!(closes_epoch > Consensus::current_epoch(), "Closing epoch must be in the future");
            Component::new(Self { funds:Vault::from_bucket(funding),
                sponsor:CallerContext::transaction_signer_public_key(), distributor,
                refund_account, reward:amount, closes_epoch, receipts:BTreeSet::new(), closed:false })
                .with_owner_rule(OwnerRule::None)
                .with_access_rules(ComponentAccessRules::new().default(rule!(allow_all)))
                .create()
        }

        /// Receipt MUST be independent random bytes, never an invitation token,
        /// patient identifier, answer hash, or other survey-derived value.
        /// The contract can enforce its shape and uniqueness, not its provenance.
        pub fn pay(&mut self, receipt: String, transfer: StealthTransferStatement) {
            assert_eq!(CallerContext::transaction_signer_public_key(),self.distributor,"Distributor only");
            assert!(!self.closed && Consensus::current_epoch() < self.closes_epoch,"Pool closed");
            assert!(receipt.len()==64 && receipt.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()),"Invalid receipt");
            assert!(!self.receipts.contains(&receipt),"Receipt already paid");
            assert!(self.receipts.len()<10_000,"Receipt capacity reached");
            assert_eq!(transfer.inputs_statement.revealed_amount,self.reward,"Incorrect reward amount");
            assert!(transfer.inputs_statement.inputs.is_empty(),"External inputs not allowed");
            assert_eq!(transfer.outputs_statement.outputs.len(),1,"Exactly one stealth recipient required");
            assert!(transfer.outputs_statement.revealed_output_amount.is_zero(),"Public payout not allowed");
            assert!(transfer.balance_proof.is_some(),"Balance proof required");
            assert!(transfer.covenant_claims.is_empty(),"Covenant claims not allowed");
            // Engine verifies range/balance proofs and atomically creates the
            // output. Any failure rolls back both the receipt and withdrawal.
            self.receipts.insert(receipt);
            let remainder=self.funds.withdraw(self.reward).stealth_transfer(transfer);
            assert!(remainder.amount().is_zero(),"Reward not fully transferred");
            self.funds.deposit(remainder);
        }

        pub fn reclaim(&mut self) {
            assert_eq!(CallerContext::transaction_signer_public_key(),self.sponsor,"Sponsor only");
            assert!(!self.closed,"Pool already reclaimed");
            assert!(Consensus::current_epoch()>=self.closes_epoch,"Pool still open");
            self.closed=true;
            ComponentManager::get(self.refund_account).invoke("deposit",args![self.funds.withdraw_all()]);
        }

        pub fn paid_count(&self)->u64 {self.receipts.len() as u64}
        pub fn remaining(&self)->Amount {self.funds.balance()}
    }
}
