# Ootle Surveys — encrypted questionnaires with private participation rewards

Ootle Surveys is our entry for the September Ootle contest. It is a self-hosted
survey application and Rust/WASM reward template for a practical workflow:
ask questions, collect encrypted responses, and pay people for their participation.

**Code and setup:** https://github.com/JustAResearcher/ootle-surveys

**License:** MIT

## What it does

- Creates questionnaires with short answers, long answers, multiple choice, and ratings.
- Generates individual invitation links, with one submission per invitation.
- Encrypts questionnaire content, responses, and participant reward addresses before storage.
- Lets the organizer unlock responses locally and approve participation.
- Pays 1 tTARI per approved response through an Ootle template using a stealth output.

## Why Ootle

The reward pool is an actual Ootle component. It enforces a funded budget,
distributor authorization, exact reward amounts, one-use random payment receipts,
stealth-only payouts, a closing epoch, and sponsor-only reclamation after expiry.
Questions, answers, invitation tokens, and response hashes are not published on-chain.

## Verified behavior

We exercised the complete browser workflow from questionnaire creation through
participant submission, organizer decryption, approval, and a confirmed Esmeralda
payout. The recipient independently decrypted exactly 1 tTARI. A different wallet
could not decrypt the separate recipient-privacy test output, and repeating an
approval did not create a second payment.

Four Ootle engine tests cover authorization, duplicate receipts, budget exhaustion,
public-payout rejection, malformed receipts, and closing/refund behavior. Five
encryption tests and an HTTP integration suite cover tampering, wrong keys,
response-context substitution, unauthorized access, one-use invitations, and
encrypted storage. Desktop and mobile browser checks passed.

Source, screenshots, the compiled template, deployment addresses, transaction IDs,
and validation details are in the repository.

## Privacy and prototype boundaries

The organizer can read responses and reward addresses and can correlate them with
payments. Public observers can see pool funding, the sponsor, the fixed reward
amount, receipt use, and timing. Stealth outputs conceal the recipient; this is not
a claim of total anonymity. Completion approval is trusted to the organizer.

This is a local/self-hosted testnet prototype, not a hosted production service.
Public HTTPS deployment, real-user concurrency, backup restoration, outage recovery,
and independent security review remain unqualified.

## Submission details

- Prize-payment address: supplied directly with the forum submission.
- Public social announcement: https://x.com/CaptainCrypto33/status/2102173013311442948
