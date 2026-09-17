/** Type declarations for the pipeline safety gate. Kept alongside the
 *  implementation so the test suite is fully typechecked. */

export interface Limits {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  maxPagesPerDomain: number;
  perHostDelayMs: number;
  maxRetries: number;
  userAgent: string;
}
export const LIMITS: Limits;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function isAllowedUrl(rawUrl: string, allowedDomains: string[]): UrlCheck;
export function hostMatchesDomain(host: string, domain: string): boolean;
export function assertPublicHost(hostname: string): Promise<void>;
export function assertSafeId(id: string): string;
export function looksLikeChallenge(html: string | null): boolean;

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  reason?: string;
  contentType?: string;
  body?: Buffer;
  text?: string | null;
}
export function safeFetch(
  rawUrl: string,
  allowedDomains: string[],
  opts?: { accept?: string },
): Promise<FetchResult>;
