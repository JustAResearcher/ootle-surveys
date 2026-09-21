use tari_template_lib::prelude::*;
use tari_template_test_tooling::{TemplateTest,crypto::{RistrettoPublicKey,RistrettoSecretKey,PublicKey},byte_type::ToByteType,transaction::args,engine_types::virtual_substate::{VirtualSubstate,VirtualSubstateId},support::{stealth,assert_error::assert_reject_reason}};

fn setup()->(TemplateTest,ComponentAddress,ComponentAddress,RistrettoSecretKey,RistrettoSecretKey){
    let mut t=TemplateTest::my_crate();let template=t.get_template_address("PrivateRewards");
    let(sponsor,_,sponsor_key)=t.create_funded_account();let(_,_,distributor_key)=t.create_empty_account();
    let distributor=RistrettoPublicKey::from_secret_key(&distributor_key).to_byte_type();
    t.execute_expect_success(t.transaction().call_method(sponsor,"withdraw",args![TARI_TOKEN,Amount::from(2_000_000u64)])
        .put_last_instruction_output_on_workspace("funds")
        .call_function(template,"new",args![Workspace("funds"),distributor,sponsor,1_000_000u64,10u64])
        .build_and_seal(&sponsor_key),vec![]);
    let(pool,_)=t.read_only_state_store().get_components_by_template_address(template).unwrap().remove(0);
    (t,pool,sponsor,sponsor_key,distributor_key)
}

#[test]
fn stealth_payment_prevents_duplicate_receipts_and_budget_overrun(){
    let(mut t,pool,_,_,key)=setup();
    for byte in ["aa","bb"] {
        let statement=stealth::generate_mint_statement([1_000_000u64],0u64,None).statement;
        let result=t.execute_expect_success(t.transaction().call_method(pool,"pay",args![byte.repeat(32),statement]).build_and_seal(&key),vec![]);
        let count=result.finalize.any_accept().unwrap().up_iter().filter(|(_,s)|s.substate_value().as_utxo().is_some()).count();
        assert_eq!(count,1,"one real stealth output");
    }
    let statement=stealth::generate_mint_statement([1_000_000u64],0u64,None).statement;
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["aa".repeat(32),statement.clone()]).build_and_seal(&key),vec![]);
    assert_reject_reason(reason,"Receipt already paid");
    t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["cc".repeat(32),statement]).build_and_seal(&key),vec![]);
    assert_eq!(t.call_method::<u64>(pool,"paid_count",args![],vec![]),2);
}

#[test]
fn rejects_public_payments_and_unauthorized_distributor(){
    let(mut t,pool,_,sponsor,key)=setup();
    let private=stealth::generate_mint_statement([1_000_000u64],0u64,None).statement;
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["aa".repeat(32),private]).build_and_seal(&sponsor),vec![]);
    assert_reject_reason(reason,"Distributor only");
    let public=StealthTransferStatement::revealed_only(Amount::from(1_000_000u64),Amount::from(1_000_000u64));
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["aa".repeat(32),public]).build_and_seal(&key),vec![]);
    assert_reject_reason(reason,"Exactly one stealth recipient required");
}

#[test]
fn deadline_stops_rewards_and_returns_unused_funds_once(){
    let(mut t,pool,sponsor,sponsor_key,key)=setup();
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"reclaim",args![]).build_and_seal(&sponsor_key),vec![]);
    assert_reject_reason(reason,"Pool still open");
    t.set_virtual_substate(VirtualSubstateId::CurrentEpoch,VirtualSubstate::CurrentEpoch(10));
    let statement=stealth::generate_mint_statement([1_000_000u64],0u64,None).statement;
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["aa".repeat(32),statement]).build_and_seal(&key),vec![]);
    assert_reject_reason(reason,"Pool closed");
    t.execute_expect_success(t.transaction().call_method(pool,"reclaim",args![]).build_and_seal(&sponsor_key),vec![]);
    assert_eq!(t.read_only_state_store().get_vaults_for_account(sponsor).unwrap()[&TARI_TOKEN].balance(),Amount::from(TemplateTest::FUNDED_ACCOUNT_INITIAL_BALANCE));
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"reclaim",args![]).build_and_seal(&sponsor_key),vec![]);
    assert_reject_reason(reason,"Pool already reclaimed");
}

#[test]
fn rejects_wrong_amount_receipt_and_distributor_reclaim_without_consuming_receipt(){
    let(mut t,pool,_,_,key)=setup();
    let statement=stealth::generate_mint_statement([500_000u64],0u64,None).statement;
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["aa".repeat(32),statement]).build_and_seal(&key),vec![]);
    assert_reject_reason(reason,"Incorrect reward amount");
    let valid=stealth::generate_mint_statement([1_000_000u64],0u64,None).statement;
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"pay",args!["not-a-random-receipt",valid.clone()]).build_and_seal(&key),vec![]);
    assert_reject_reason(reason,"Invalid receipt");
    assert_eq!(t.call_method::<u64>(pool,"paid_count",args![],vec![]),0);
    t.execute_expect_success(t.transaction().call_method(pool,"pay",args!["aa".repeat(32),valid]).build_and_seal(&key),vec![]);
    t.set_virtual_substate(VirtualSubstateId::CurrentEpoch,VirtualSubstate::CurrentEpoch(10));
    let reason=t.execute_expect_failure(t.transaction().call_method(pool,"reclaim",args![]).build_and_seal(&key),vec![]);
    assert_reject_reason(reason,"Sponsor only");
}
