/**
 * sha256Hex
 * Computes SHA-256 of input string and returns hex string.
 * - Inputs: s string
 * - Outputs: hex string
 * - Failure modes: SubtleCrypto unavailable (very old browsers)
 */
export async function sha256Hex(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

