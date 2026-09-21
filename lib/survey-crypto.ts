import { toBase64, fromBase64 } from "./envelopes.mjs";
const enc = new TextEncoder();
export const randomHex = (length = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const unhex = (value: string) =>
  Uint8Array.from(value.match(/../g)!.map((b) => parseInt(b, 16)));
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export type Sealed = { iv: string; data: string };
export async function seal(
  keyHex: string,
  value: unknown,
  context: string,
): Promise<Sealed> {
  const key = await crypto.subtle.importKey(
    "raw",
    unhex(keyHex),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(context) },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { iv: toBase64(iv), data: toBase64(data) };
}
export async function open(keyHex: string, value: Sealed, context: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    unhex(keyHex),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const data = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(value.iv),
      additionalData: enc.encode(context),
    },
    key,
    fromBase64(value.data),
  );
  return JSON.parse(new TextDecoder().decode(data));
}
export type LockedKey = { salt: string; iv: string; data: string };
async function passwordKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 600000,
      salt: salt as BufferSource,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function lockPrivateKey(
  key: CryptoKey,
  password: string,
): Promise<LockedKey> {
  if (password.length < 12)
    throw new Error("Use a vault password with at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: enc.encode("ootle-surveys/vault/v1"),
    },
    await passwordKey(password, salt),
    enc.encode(JSON.stringify(await crypto.subtle.exportKey("jwk", key))),
  );
  return { salt: toBase64(salt), iv: toBase64(iv), data: toBase64(data) };
}
export async function unlockPrivateKey(saved: LockedKey, password: string) {
  const raw = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(saved.iv),
      additionalData: enc.encode("ootle-surveys/vault/v1"),
    },
    await passwordKey(password, fromBase64(saved.salt)),
    fromBase64(saved.data),
  );
  return crypto.subtle.importKey(
    "jwk",
    JSON.parse(new TextDecoder().decode(raw)),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}
