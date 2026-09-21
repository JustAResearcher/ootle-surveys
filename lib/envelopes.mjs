// Standard WebCrypto hybrid encryption. This is an encrypted envelope primitive,
// not a complete HIPAA control set or an authorization layer.
const encoder = new TextEncoder();
const DOMAIN = "ootle-surveys/response/v1";
const MAX_PLAINTEXT = 128 * 1024;

export function toBase64(bytes) {
  return btoa(
    Array.from(new Uint8Array(bytes), (b) => String.fromCharCode(b)).join(""),
  );
}
export function fromBase64(value) {
  if (typeof value !== "string" || value.length > 256 * 1024)
    throw new Error("Invalid envelope");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function context(id) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid response context");
  return encoder.encode(`${DOMAIN}:${id}`);
}

export async function createOrganizerKeys(extractable = false) {
  // The private key remains in the organizer context; only export publicKey.
  return crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    extractable,
    ["encrypt", "decrypt"],
  );
}

export async function exportPublicKey(publicKey) {
  return crypto.subtle.exportKey("jwk", publicKey);
}

export async function encryptResponse(publicJwk, responseId, answers) {
  const plaintext = encoder.encode(JSON.stringify(answers));
  if (plaintext.byteLength > MAX_PLAINTEXT)
    throw new Error("Response too large");
  const aad = context(responseId);
  const recipient = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    plaintext,
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  try {
    const wrapped = await crypto.subtle.encrypt(
      { name: "RSA-OAEP", label: aad },
      recipient,
      raw,
    );
    return {
      version: 1,
      context: responseId,
      iv: toBase64(iv),
      wrappedKey: toBase64(wrapped),
      ciphertext: toBase64(ciphertext),
    };
  } finally {
    raw.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptResponse(
  privateKey,
  expectedResponseId,
  envelope,
) {
  if (envelope?.version !== 1 || envelope.context !== expectedResponseId)
    throw new Error("Envelope context mismatch");
  const aad = context(expectedResponseId),
    iv = fromBase64(envelope.iv);
  if (iv.length !== 12) throw new Error("Invalid nonce");
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "RSA-OAEP", label: aad },
      privateKey,
      fromBase64(envelope.wrappedKey),
    ),
  );
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        key,
        fromBase64(envelope.ciphertext),
      ),
    );
    try {
      if (plaintext.length > MAX_PLAINTEXT)
        throw new Error("Response too large");
      return JSON.parse(new TextDecoder().decode(plaintext));
    } finally {
      plaintext.fill(0);
    }
  } finally {
    raw.fill(0);
  }
}

// This independent value may go on-chain. It has no mathematical relationship
// to an invitation, survey, response, identity, or response ciphertext.
export function randomRewardReceipt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
