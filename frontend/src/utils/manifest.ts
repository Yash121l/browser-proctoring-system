import { uploadDirect, presignAndUpload } from "./upload";

type Entry = { key?: string; url?: string; ts: number; seq: number; source: 'screen'|'camera' };

type CacheKey = string; // `${testId}|${userId}`

const cache = new Map<CacheKey, { chunks: Entry[] }>();

function k(testId: string, userId: string): CacheKey { return `${testId}|${userId}`; }

export const CombinedManifestWriter = {
  addChunk: async (opts: {
    token: string;
    apiBaseUrl: string;
    testId: string;
    userId: string;
    entry: Entry;
  }) => {
    const key = k(opts.testId, opts.userId);
    const m = cache.get(key) || { chunks: [] };
    // De-duplicate by key/url+seq
    const exists = m.chunks.find((c) => (c.key && c.key === opts.entry.key) || (c.url === opts.entry.url) || (c.seq === opts.entry.seq && c.source === opts.entry.source));
    if (!exists) {
      m.chunks.push({ ...opts.entry });
      m.chunks.sort((a, b) => Number(a.seq) - Number(b.seq));
    }
    cache.set(key, m);
    const blob = new Blob([JSON.stringify({ chunks: m.chunks })], { type: 'application/json' });
    try {
      await uploadDirect({
        token: opts.token,
        apiBaseUrl: opts.apiBaseUrl,
        blob,
        contentType: 'application/json',
        testId: opts.testId,
        userId: opts.userId,
        contextExtras: { name: 'manifest.json' },
      });
    } catch {
      try {
        await presignAndUpload({
          token: opts.token,
          apiBaseUrl: opts.apiBaseUrl,
          blob,
          contentType: 'application/json',
          testId: opts.testId,
          userId: opts.userId,
          contextExtras: { name: 'manifest.json' },
        });
      } catch {
        // ignore persistence error; next chunk will try again
      }
    }
  }
};

