import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrganizerKeys,
  exportPublicKey,
  encryptResponse,
  decryptResponse,
  randomRewardReceipt,
  fromBase64,
  toBase64,
} from "../lib/envelopes.mjs";

const organizer = await createOrganizerKeys();
const publicKey = await exportPublicKey(organizer.publicKey);
const id = "ab".repeat(32);
const answers = {
  questions: [{ id: "q1", answer: "Synthetic test response only" }],
};

test("only organizer can decrypt; storage envelope contains no plaintext answers", async () => {
  const envelope = await encryptResponse(publicKey, id, answers);
  assert.deepEqual(
    await decryptResponse(organizer.privateKey, id, envelope),
    answers,
  );
  assert.ok(!JSON.stringify(envelope).includes("Synthetic"));
  const stranger = await createOrganizerKeys();
  await assert.rejects(decryptResponse(stranger.privateKey, id, envelope));
  await assert.rejects(crypto.subtle.exportKey("jwk", organizer.privateKey));
});
test("ciphertext, key envelope, and nonce tampering fail authentication", async () => {
  const envelope = await encryptResponse(publicKey, id, answers);
  for (const field of ["ciphertext", "wrappedKey", "iv"]) {
    const bytes = fromBase64(envelope[field]);
    bytes[0] ^= 1;
    await assert.rejects(
      decryptResponse(organizer.privateKey, id, {
        ...envelope,
        [field]: toBase64(bytes),
      }),
    );
  }
});
test("response cannot be substituted across contexts", async () => {
  const envelope = await encryptResponse(publicKey, id, answers);
  await assert.rejects(
    decryptResponse(organizer.privateKey, "cd".repeat(32), envelope),
  );
  await assert.rejects(
    decryptResponse(organizer.privateKey, "cd".repeat(32), {
      ...envelope,
      context: "cd".repeat(32),
    }),
  );
});
test("identical answers use fresh encryption and oversized responses fail", async () => {
  const a = await encryptResponse(publicKey, id, answers),
    b = await encryptResponse(publicKey, id, answers);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.wrappedKey, b.wrappedKey);
  await assert.rejects(encryptResponse(publicKey, id, "x".repeat(130 * 1024)));
});
test("reward receipts are independent random identifiers", () => {
  const receipts = Array.from({ length: 100 }, randomRewardReceipt);
  assert.equal(new Set(receipts).size, 100);
  receipts.forEach((v) => assert.match(v, /^[a-f0-9]{64}$/));
});
