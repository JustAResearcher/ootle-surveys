# Running Ootle Surveys

Requires Node.js 24+. One installation has one organizer vault, one organizer access
code and one operator wallet. The contract uses Esmeralda test tokens, with a fixed
reward of 1 tTARI and a fixed closing epoch. It has not been independently audited.

## Start and configure

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:4182. Find the organizer access code in
`data/admin-access.txt`; choose a separate vault password of at least 12 characters.
Download an encrypted vault backup and keep its password separately. The application
can save encrypted drafts before a pool is connected. To fund a pool:

```sh
npm run setup:testnet
```

Setup prints the operator's receiving address until test tokens are available.
Use the [funding and reset guide](TESTNET-FUNDING.md); the old public L2 faucet
cannot be relied on after the Ootle 0.42 reset. Existing installations should
prepare and verify a separate reset candidate before replacing active chain settings.

Restart the server after setup completes. On Windows, `scripts/start.ps1` installs
missing dependencies, builds the UI and launches a hidden server process. It checks
an existing listener's application identity before accepting it as this app.

Configuration is read from the process environment. Start in the project directory.

| Variable               | Default                            | Purpose                                                                              |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `SURVEY_PORT`          | `4182`                             | Loopback HTTP listener                                                               |
| `SURVEY_DATA_DIR`      | `data`                             | Organizer code, database, operator keys and deployment; shared by start/setup/backup |
| `SURVEY_DB_FILE`       | `<data-dir>/surveys.sqlite`        | Optional database override                                                           |
| `SURVEY_PUBLIC_ORIGIN` | `http://127.0.0.1:<port>`          | Exact origin used for invitation links and permitted browser requests                |
| `SURVEY_INDEXER_URL`   | `https://ootle-indexer-a.tari.com` | Indexer for the Esmeralda network                                                    |

`GET /api/health` returns app identity and version. It checks application liveness;
the organizer's funding view separately verifies testnet readiness. An indexer outage
does not prevent login, draft saving or reading stored responses. Publishing and
reward approval require verified, unexpired funding.

## Daily workflow

1. Unlock the vault, write questions and choose the invitation count.
2. Use **Save encrypted draft** for unfinished work. Save is explicit; edits are
   not automatically persisted. Reloading with unsaved edits prompts the browser.
3. Preview and reorder questions, then create the survey. Only publishing reserves
   funding. The available balance excludes active invitations and unpaid responses.
4. Send a different private invitation link to each participant. Used links remain
   visible with their submitted status; downloading invitations does not send them.
5. Review responses by survey/status, search answers locally, then approve participation.
   Approval should depend on participation, not the opinion expressed in an answer.
6. Export only when needed: the confirmed CSV contains readable answers and must be
   kept private. It excludes reward addresses and guards against spreadsheet formulas.
7. Close a survey when finished. Closure stops unused invitations and releases their
   reservation; submitted responses remain eligible until the contract pool expires.

Locking or signing out clears decrypted values from the interface. The vault also
locks after 15 minutes without pointer/keyboard activity. Save drafts before leaving
the browser unattended. Drafts and responses are encrypted on the server; answer search
and export happen after decryption in the organizer's browser. No plaintext drafts or
responses are saved to browser storage.

## HTTPS hosting

Install on a host running Node.js 24+, persist its data directory on durable storage,
and put an HTTPS reverse proxy in front of the loopback listener. Configure, for example:

```sh
SURVEY_PUBLIC_ORIGIN=https://surveys.example.org npm start
```

On PowerShell, set `$env:SURVEY_PUBLIC_ORIGIN = 'https://surveys.example.org'` before
starting. Use the exact origin without a trailing slash or path. External HTTP origins
are rejected. The app uses this origin for invitation links even when the organizer
opens it over loopback. Confirm the resulting links open on another device before
distributing them. This repository does not provision a public host, DNS, TLS or email.

Keep the backend bound to loopback and do not publish its data directory. Restrict
file access to the operator account, including Windows ACLs. Testnet keys and the
organizer access code are sensitive. Trust only an indexer configured for Esmeralda.
Run one server process per database; the payment serialization lock is per process.

## Payment recovery

The service records a random payment receipt before submission and saves the returned
transaction ID immediately. It never automatically retries transaction submission.
If a payment outcome is uncertain, choose **Check existing payment**. That endpoint
only reads the existing receipt/transaction from Ootle and can mark an existing payout
confirmed; it cannot broadcast or issue a replacement reward. The normal payment
endpoint refuses to resubmit a response marked paying/uncertain.

If checking cannot confirm the payment, preserve the database and operator keys, inspect
the recorded transaction and the component's receipt set, and reconcile with the operator.
Do not edit its status back to submitted to force another payment. An unavailable
indexer is not evidence that a transaction failed. Testnet resets can invalidate
the deployment. The expired contract has no extension or upgrade method.

## Complete backup and restore

An encrypted vault download contains only decryption keys, not questionnaires,
responses or payment receipts. Use a complete installation backup:

```sh
npm run backup
npm run backup -- /secure/backup-directory
```

The backup command uses Node's SQLite online backup API so committed WAL records are
included while the app runs. It writes a new timestamped directory containing the
database, organizer access code, available operator/deployment files and SHA-256
checksums. Do not run setup concurrently with a backup. Back up to access-controlled,
encrypted storage: operator wallet keys and the access code are not password encrypted.
A copy on the same disk is not protection against disk failure.

To restore, stop every server process and preserve the existing data directory first.
Verify the manifest's SHA-256 values, then restore the snapshot files to a fresh data
directory. Start with `SURVEY_DATA_DIR` pointing there; leave `SURVEY_DB_FILE` unset
unless deliberately overriding it. Unlock with the original vault password. You can
also import the encrypted vault backup: an existing vault accepts only the same public
key, and the browser verifies the password/key pair before creating a vault from backup.
There is no password-reset backdoor. Loss of the password and all usable key backups
means loss of access to encrypted records.

Treat a restored database as potentially behind the chain. Reconcile recorded pending
payments before approving more responses, and confirm the component's remaining funding.
The backup tool does not broadcast transactions or restore files automatically.
