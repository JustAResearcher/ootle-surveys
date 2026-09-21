# Privacy design

## Trust boundaries

- Respondent browser: plaintext questionnaire and answers; encryption before upload.
- Organizer browser: authorized plaintext access and participation approval.
- Survey storage: encrypted question and response envelopes; never logs plaintext.
- Organizer vault: password-encrypted RSA private key; password stays in the browser.
- Invitation service: random capabilities, single-use state, no on-chain publication.
- Reward service: payment destinations and approved random receipts; no responses.
- Ootle: generic reward funding, authorized payouts, random anti-replay receipts,
  stealth outputs. Public sponsor signature, fee, timing, and funding metadata remain.

Do not reuse an identity, invitation hash, response digest, email address,
or questionnaire identifier as an on-chain anti-replay receipt. Separate the
survey content from payment payloads and encryption keys. Use a generic pool with
no questionnaire names or descriptions. A generic pool does not guarantee unlinkability:
timing, amounts, small cohorts, and sponsor identity still need analysis.

## Completion and payment

An organizer approves participation without judging answers. A funded pool is
not a guarantee of automatic completion approval. The distributor can misapprove
rewards; the contract cannot determine human participation from encrypted text.
Document this trust explicitly. Participant payouts must use stealth outputs,
not an ordinary public account transfer disguised as private payment.

## Clarified scope

The user explicitly removed ALL medical requirements. Build a general-purpose
private paid survey app. No clinical workflows or HIPAA claims are in scope.
The organizer can read answers and approve participation; privacy is from the
public and unauthorized parties, not from the authorized survey organizer.

## Initial acceptance checks

- No response, question, contact, invitation token, or response digest in chain state.
- No raw answers or secrets in HTTP logs, analytics, query strings, or error reports.
- Encryption tampering and wrong-recipient decryption fail closed.
- One invitation cannot submit twice; one reward receipt cannot pay twice.
- Unauthorized reward callers cannot withdraw or change payout rules.
- Payout and expiry boundaries are tested in the actual Ootle engine.
- Live testnet evidence distinguishes recipient stealth privacy from public timing.
- No production-ready or total-anonymity claim from prototype validation.

## Implemented boundary

Questionnaires use AES-256-GCM with a random per-survey key carried in the invitation
URL fragment. Raw invitation capabilities are hashed in storage. Responses and reward
addresses use fresh AES-256-GCM keys wrapped with RSA-OAEP-3072/SHA-256 to the organizer.
The expected response context authenticates both layers. Keys for response decryption
are backed up with password-derived AES-256-GCM (PBKDF2-SHA-256, 600,000 iterations).

The organizer and server can correlate invitation, response, and reward records.
This design does not claim unlinkability against colluding organizers/operators.
The payout API receives a destination and random receipt, never plaintext answers.
The client trusts the origin serving its JavaScript; compromise of that origin or
an unlocked organizer device can expose plaintext. Use HTTPS for external deployment.

The local instance binds to loopback, has a separate random organizer access token,
enforces Host/Origin allowlists, and uses a restrictive CSP. There is no analytics
or request-body logging. The QA database is separate from the empty working instance.
