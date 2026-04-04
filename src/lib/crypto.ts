// AES-GCM encryption for PAT storage in D1 (multi-tenant)
// Key comes from ENCRYPTION_KEY Worker Secret — never touches D1
// Single-tenant: this module is never called — PAT lives in Worker Secret only

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits — standard for AES-GCM

interface EncryptedPayload {
  iv: string; // base64
  ciphertext: string; // base64
}

// ─────────────────────────────────────────────────────────────────
// Import raw key from hex string (ENCRYPTION_KEY secret)
// ─────────────────────────────────────────────────────────────────
async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

// ─────────────────────────────────────────────────────────────────
// Encrypt a PAT string → JSON string to store in D1
// ─────────────────────────────────────────────────────────────────
export async function encryptPat(
  pat: string,
  encryptionKey: string,
): Promise<string> {
  const key = await importKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(pat),
  );

  const payload: EncryptedPayload = {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };

  return JSON.stringify(payload);
}

// ─────────────────────────────────────────────────────────────────
// Decrypt a PAT string from D1 → raw PAT
// ─────────────────────────────────────────────────────────────────
export async function decryptPat(
  encrypted: string,
  encryptionKey: string,
): Promise<string> {
  const payload = JSON.parse(encrypted) as EncryptedPayload;
  const key = await importKey(encryptionKey);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.ciphertext);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data,
  );

  return new TextDecoder().decode(plaintext);
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
