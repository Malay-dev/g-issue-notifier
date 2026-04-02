export function generateId(): string {
  return crypto.randomUUID();
}

export function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export function truncate(text: string, max = 300): string {
  if (!text) return "No description provided.";
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

export function validateHmac(
  secret: string,
  signature: string,
  body: string,
): Promise<boolean> {
  console.log(`[utils.validateHmac] Validating HMAC signature`);
  // Used by github-webhook to verify payload authenticity
  const encoder = new TextEncoder();
  return crypto.subtle
    .importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    .then((key) => crypto.subtle.sign("HMAC", key, encoder.encode(body)))
    .then((sig) => {
      const hex =
        "sha256=" +
        Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      const isValid = hex === signature;
      console.log(
        `[utils.validateHmac] Signature validation result: ${isValid}`,
      );
      return isValid;
    });
}
