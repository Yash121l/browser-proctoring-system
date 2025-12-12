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
}): Promise<{ url: string; key: string }> {
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
  const { url, key } = (await res.json()) as { url: string; key: string };

  const put = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`upload failed: ${put.status}`);

  return { url, key };
}

