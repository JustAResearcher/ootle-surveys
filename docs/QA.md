# Validation — 2026-09-30 / Ootle 0.42

The replacement template and 100 tTARI pool were published after the September 30
reset. Funding came from an Esmeralda L1 faucet, a 200 tXTM burn, its confirmed
Ootle claim, and an atomic funded-account bootstrap. No mainnet funds were used.

- TypeScript/Vite build: passed.
- Node suite: 12 passed, zero failures; the optional legacy external-HTTP suite
  remains skipped. The self-contained HTTP lifecycle suite runs and passes.
- Ootle 0.42 engine: all four tests passed, including the new mixed public/private
  output rejection within the authorization test.
- Native Rust claim helper: built successfully; canonical proof conversion,
  recipient ownership and a real committed claim verified.
- Two separate live 1 tTARI payouts: exact recipient decryption and wrong-wallet
  rejection verified. See `artifacts/testnet-verification.json` and
  `artifacts/browser-payment-verification.json` for current transaction IDs.
- Full browser flow on loopback port 4184: encrypted draft save/reload/unlock,
  resume, publish, funded invitations, encrypted participant response, organizer
  decryption, approval confirmation, and displayed confirmed reward all passed.
- Repeating HTTP approval returned the same transaction without another payment.
  Repeating the CLI verification also reconciled its original payout. The pool
  contains two paid receipts and 98 tTARI remains.
- Synthetic questionnaire and answer sentinels were absent from the SQLite,
  WAL and SHM bytes. No relevant browser console errors were observed.
- An occupied port now exits with an error instead of printing a misleading
  successful startup message.

Browser verification used the Codex in-app browser with its normal viewport.
This migration did not redesign the layout; the earlier desktop/mobile visual
checks below are historical, not new responsive measurements. The main app uses
its existing database; synthetic verification records stayed in a separate QA
directory. The native funding helpers and payment path are testnet-only.

The indexer accepted an early execution-only burn dry run, while validators
correctly rejected the immature claim. That abort consumed no funds. The claim
workflow now checks scanned block height and a later epoch before submission;
an explicit retry is permitted only for a confirmed NotYetValid rejection. Tests
cover both the full finalized abort and the indexer's compacted Rejected response.

This is local and live-testnet validation, not an independent security audit.
Historical deployment files are in `artifacts/history/pre-reset-20260930`.

# Historical validation — 2026-09-21

## Functional evidence

The complete organizer/participant flow was exercised through the Codex in-app
browser on port 4183 using a separate QA database and synthetic data: create
questionnaire, share individual link, submit encrypted answer, decrypt as organizer,
approve, and display a confirmed private reward.

`artifacts/browser-payment-verification.json` records independent recipient-side
decryption of exactly 1,000,000 microTARI and a repeated approval that returned the
existing transaction without paying twice. `artifacts/testnet-verification.json`
also records a different wallet's inability to decrypt another recipient's output.
These checks used actual Esmeralda transactions.

Four engine tests and six Node test suites passed. The HTTP suite checked unauthorized
access, hostile Origin/Host requests, single-use invitations, wrong response contexts,
closed surveys, and no plaintext answers, questionnaire title, or invitation tokens
in SQLite/WAL. The Host test uses node:http because fetch ignored a custom Host header.
TypeScript/Vite builds pass; the dependency audit reports zero known vulnerabilities.
This is not an independent security audit or a mainnet deployment.

## Browser and visual verification

Reference: `design/concept.png`, 1536×1024. `view_image` was used on the concept and
rendered screenshots in the same inspection pass. The in-app browser completed the
interactive workflow with no relevant console errors. Its viewport and CDP overrides
both remained at 662×441, so desktop/mobile screenshots used Playwright with installed
Chrome: 1536×1024 and 390×844. Document width matched viewport width at both sizes.

| Comparison | Result |
| --- | --- |
| Copy | Heading, subtitle, editor labels, reward text, CTA, and footer match |
| Layout | 44px desktop gutters, two-column builder, surveys below preserved |
| Typography | System font retains the large heading, label, and reward hierarchy |
| Palette | White, indigo ink, violet actions, and cool thin borders preserved |
| Containers/spacing | Rounded panels and question editor follow the concept |
| Responsive | Form stacks above reward settings at 390px without overflow |
| Icons/states | Add icon, checkbox toggle, and nav states are functional and accessible |

Above-the-fold copy diff: no unintended additions. Intentional extensions are vault
unlock/backup/lock controls, loading/error feedback, and real survey rows replacing
the empty state. The decorative network chevron was omitted because there is no
network selector. Native select/number controls replace concept-drawn arrows.
The UI was verified against the adopted design; no material visual mismatch remains.

The working user instance runs on port 4182 with an empty database. It contains none
of the QA password, synthetic questionnaires, or participant records. Screenshots
of the final empty instance are provided separately from test evidence.
