/**
 * presignAndUpload
 * Requests a pre-signed URL from the backend and PUTs the Blob to S3.
 * - Inputs: token (JWT), apiBaseUrl, blob (evidence), contentType, testId, userId
 * - Outputs: { url, key }
 * - Failure modes: 401 JWT invalid; presign failure; PUT failure
 * - Security: Only uploads on violations; URL expires quickly server-side.
 */
export async function presignAndUpload(opts: {
  token: string;
  apiBaseUrl: string;
  blob: Blob;
  contentType: string;
  testId: string;
  userId: string;
}): Promise<{ url: string; key: string; viewUrl?: string }> {
  const { token, apiBaseUrl, blob, contentType, testId, userId } = opts;
  const res = await fetch(`${apiBaseUrl}/presign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: JSON.stringify({
      contentType,
      context: { testId, userId, kind: "evidence" },
    }),
  });
  if (!res.ok) throw new Error(`presign failed: ${res.status}`);
  const { url, key, viewUrl } = (await res.json()) as { url: string; key: string; viewUrl?: string };

  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);

  return { url, key, viewUrl };
}

/**
 * uploadDirect
 * Bypasses S3 CORS by sending base64 bytes to backend /presign/direct which
 * streams to S3. Slightly heavier on server but avoids client preflight.
 */
export async function uploadDirect(opts: {
  token: string;
  apiBaseUrl: string;
  blob: Blob;
  contentType: string;
  testId: string;
  userId: string;
}): Promise<{ url: string; key: string }> {
  const { token, apiBaseUrl, blob, contentType, testId, userId } = opts;
  const buf = await blobToBase64(blob);
  const res = await fetch(`${apiBaseUrl}/presign/direct`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    body: JSON.stringify({ contentType, context: { testId, userId }, dataBase64: buf }),
  });
  if (!res.ok) throw new Error(`direct upload failed: ${res.status}`);
  return (await res.json()) as { url: string; key: string };
}

async function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result || "");
      const base64 = s.startsWith("data:") ? s.split(",")[1] : s;
      resolve(base64);
    };
    fr.readAsDataURL(b);
  });
}
