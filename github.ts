import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

/** Turn Git clone URLs into credential-free, browser-safe GitHub links. */
export function githubRepositoryUrl(remote: string | null | undefined): string | null {
  if (!remote || /[\s\x00-\x1f]/.test(remote)) return null;
  const scp = /^(?:git@)?github\.com:([^?#]+)$/i.exec(remote);
  try {
    const url = new URL(scp ? `https://github.com/${scp[1]}` : remote);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '');
    if (!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(path) || path.endsWith('/..') || path.endsWith('/.')) return null;
    return `https://github.com${path}`;
  } catch { return null; }
}

export function githubPullRequestUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(url.pathname) ? `https://github.com${url.pathname}` : null;
  } catch { return null; }
}

// The bundled plugin owns discovery and refresh; keyed reads share its cache.
export const githubPrStatus = defineRpcContract({
  pullRequests: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.discriminatedUnion('outcome', [
      z.object({ outcome: z.literal('available'), pullRequest: z.object({ number: z.number(), title: z.string(), url: z.string() }).passthrough() }).passthrough(),
      z.object({ outcome: z.literal('absent') }),
      z.object({ outcome: z.literal('unavailable'), message: z.string() }),
    ])),
  },
});
