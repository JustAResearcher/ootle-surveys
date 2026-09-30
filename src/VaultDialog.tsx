import { useEffect, useRef, useState } from "react";
import {
  createOrganizerKeys,
  exportPublicKey,
  encryptResponse,
  decryptResponse,
} from "../lib/envelopes.mjs";
import { lockPrivateKey, unlockPrivateKey } from "../lib/survey-crypto";
import { api } from "./api";
export type Vault = { publicKey: JsonWebKey; privateKey: CryptoKey };
export function VaultDialog({
  token,
  onUnlock,
  onClose,
}: {
  token: string;
  onUnlock: (v: Vault) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState<any>(undefined),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [restored, setRestored] = useState<any>(null);
  const recordToOpen = restored ?? saved;
  useEffect(() => {
    ref.current?.showModal();
    void api("/admin/vault", token)
      .then(setSaved)
      .catch((e) => setError(e.message));
    return () => ref.current?.close();
  }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let record = recordToOpen;
      if (!record) {
        if (password !== confirm) throw new Error("Passwords do not match.");
        const keys = await createOrganizerKeys(true);
        record = {
          publicKey: await exportPublicKey(keys.publicKey),
          lockedKey: await lockPrivateKey(keys.privateKey, password),
        };
        await api("/admin/vault", token, record);
      }
      const privateKey = await unlockPrivateKey(record.lockedKey, password);
      if (restored) {
        const context = "0".repeat(64);
        await decryptResponse(
          privateKey,
          context,
          await encryptResponse(record.publicKey, context, { check: true }),
        );
        if (!saved) await api("/admin/vault", token, record);
      }
      onUnlock({ publicKey: record.publicKey, privateKey });
      onClose();
    } catch (e) {
      setError(
        (e as Error).name === "OperationError"
          ? "That password could not unlock the vault."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} onCancel={onClose}>
      <button
        className="close"
        aria-label="Close vault dialog"
        onClick={onClose}
      >
        ×
      </button>
      <h2>
        {saved === undefined
          ? "Loading your vault…"
          : recordToOpen
            ? "Unlock your vault"
            : "Protect your responses"}
      </h2>
      <p className="muted">
        Your password unlocks your survey keys in this browser. It is never sent
        to the server.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="vault-password">Vault password</label>
        <input
          id="vault-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={recordToOpen ? 1 : 12}
          required
          autoComplete={recordToOpen ? "current-password" : "new-password"}
        />
        {saved === null && !restored && (
          <>
            <label htmlFor="vault-confirm">Confirm password</label>
            <input
              id="vault-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
            <p className="small muted">
              Use at least 12 characters and keep the password somewhere safe.
              We cannot reset it or recover your answers without it.
            </p>
          </>
        )}
        {saved !== undefined && (
          <label className="backup-import">
            Restore an encrypted vault backup
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={async (e) => {
                setError("");
                try {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 50000)
                    throw new Error("This backup file is too large.");
                  const record = JSON.parse(await file.text());
                  if (
                    record.publicKey?.kty !== "RSA" ||
                    !record.publicKey.n ||
                    !record.publicKey.e ||
                    !record.lockedKey?.salt ||
                    !record.lockedKey.iv ||
                    !record.lockedKey.data
                  )
                    throw new Error(
                      "Choose an Ootle Surveys encrypted vault backup.",
                    );
                  if (
                    saved &&
                    (saved.publicKey.n !== record.publicKey.n ||
                      saved.publicKey.e !== record.publicKey.e)
                  )
                    throw new Error(
                      "This backup belongs to a different vault. Your existing vault was preserved.",
                    );
                  setRestored(record);
                  setPassword("");
                  setConfirm("");
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
        )}
        {restored && (
          <p className="small success">
            Backup loaded. Enter its original password to verify and unlock it.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy || saved === undefined}>
          {busy
            ? "Opening vault…"
            : recordToOpen
              ? "Unlock vault"
              : "Create vault"}
        </button>
      </form>
    </dialog>
  );
}
export async function backupVault(token: string) {
  const record = await api("/admin/vault", token);
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = u;
  a.download = "ootle-surveys-encrypted-vault.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
