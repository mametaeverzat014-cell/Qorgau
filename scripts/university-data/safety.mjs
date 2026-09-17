/**
 * Network safety gate for the ingestion pipeline.
 *
 * Every URL the pipeline touches passes through here first. Fetched websites are
 * untrusted input: they can redirect, they can resolve to internal addresses,
 * they can serve gigabytes, and they can be a Cloudflare challenge wearing a
 * university's domain name.
 *
 * The rule the whole pipeline rests on: a document is only evidence if it came
 * from a domain the registry already declared official for that institution.
 * Discovery may suggest a URL; it can never authorise one.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const LIMITS = {
  /** Abort a single request after this long. */
  timeoutMs: 20_000,
  /** Refuse bodies larger than this; university PDFs are well under it. */
  maxBytes: 12 * 1024 * 1024,
  /** Redirects are followed manually so every hop can be re-checked. */
  maxRedirects: 5,
  /** Politeness: never more than this many pages from one domain per run. */
  maxPagesPerDomain: 25,
  /** Politeness: gap between requests to the same host. */
  perHostDelayMs: 1_000,
  maxRetries: 2,
  userAgent:
    'AdmitPathBot/1.0 (+https://github.com/mametaeverzat014-cell/Qorgau; academic hackathon project; contact via repository issues)',
};

const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'text/plain',
  'application/xml',
  'text/xml',
];

/* ------------------------------------------------------------------ */
/* Address safety (SSRF)                                               */
/* ------------------------------------------------------------------ */

/** Private, loopback, link-local and cloud-metadata ranges. */
function isBlockedAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;                          // 10.0.0.0/8
    if (p[0] === 127) return true;                         // loopback
    if (p[0] === 0) return true;                           // 0.0.0.0/8
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true;         // 192.168.0.0/16
    if (p[0] === 169 && p[1] === 254) return true;         // link-local + 169.254.169.254 metadata
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true;                          // multicast / reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.startsWith('fe80')) return true;                 // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
    if (s.startsWith('::ffff:')) return isBlockedAddress(s.slice(7)); // mapped v4
    return false;
  }
  return true;
}

/** Resolves a hostname and rejects it if any address is internal. */
export async function assertPublicHost(hostname) {
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error(`blocked address: ${hostname}`);
    return;
  }
  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.internal')) {
    throw new Error(`blocked hostname: ${hostname}`);
  }
  let records;
  try {
    records = await lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`cannot resolve ${hostname}: ${err.message}`);
  }
  for (const r of records) {
    if (isBlockedAddress(r.address)) {
      throw new Error(`${hostname} resolves to a non-public address (${r.address})`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Domain allow-listing                                                */
/* ------------------------------------------------------------------ */

/** True when host is the domain itself or a subdomain of it. */
export function hostMatchesDomain(host, domain) {
  const h = host.toLowerCase().replace(/\.$/, '');
  const d = domain.toLowerCase().replace(/^\./, '');
  return h === d || h.endsWith(`.${d}`);
}

export function isAllowedUrl(rawUrl, allowedDomains) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'unparseable URL' };
  }
  if (u.protocol !== 'https:') {
    return { ok: false, reason: `only https is permitted, got ${u.protocol}` };
  }
  if (u.username || u.password) {
    return { ok: false, reason: 'credentials in URL' };
  }
  if (u.port && u.port !== '443') {
    return { ok: false, reason: `non-standard port ${u.port}` };
  }
  // Defence in depth: a malformed registry entry must not be able to open an
  // SSRF hole just by allow-listing an internal name. assertPublicHost catches
  // this at fetch time too; refusing it here means it never reaches the network.
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    isIP(host)
  ) {
    return { ok: false, reason: `${u.hostname} is not a public domain name` };
  }
  const allowed = allowedDomains.some((d) => hostMatchesDomain(u.hostname, d));
  if (!allowed) {
    return { ok: false, reason: `${u.hostname} is not an approved domain for this institution` };
  }
  return { ok: true, url: u };
}

/* ------------------------------------------------------------------ */
/* Guarded fetch                                                       */
/* ------------------------------------------------------------------ */

const lastRequestAt = new Map();

async function politeDelay(host) {
  const last = lastRequestAt.get(host) ?? 0;
  const wait = LIMITS.perHostDelayMs - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt.set(host, Date.now());
}

/**
 * Fetches a URL with every guard applied.
 *
 * Redirects are followed manually so each hop is re-validated against the
 * allow-list — a 302 from an official domain to an unrelated one must not
 * silently become authoritative.
 */
export async function safeFetch(rawUrl, allowedDomains, { accept } = {}) {
  let current = rawUrl;

  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    const check = isAllowedUrl(current, allowedDomains);
    if (!check.ok) {
      return { ok: false, status: 0, reason: `blocked: ${check.reason}`, url: current };
    }
    await assertPublicHost(check.url.hostname);
    await politeDelay(check.url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': LIMITS.userAgent,
          accept: accept ?? 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
          'accept-language': 'en',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        status: 0,
        reason: err.name === 'AbortError' ? 'timeout' : `network error: ${err.message}`,
        url: current,
      };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, status: res.status, reason: 'redirect without location', url: current };
      current = new URL(location, current).toString();
      continue; // re-validate the new hop
    }

    if (!res.ok) {
      return { ok: false, status: res.status, reason: `HTTP ${res.status}`, url: current };
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return { ok: false, status: res.status, reason: `unsupported content-type ${contentType}`, url: current };
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > LIMITS.maxBytes) {
      return { ok: false, status: res.status, reason: `body too large (${declared} bytes)`, url: current };
    }

    // Stream with a hard cap, because content-length can lie or be absent.
    const reader = res.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > LIMITS.maxBytes) {
          await reader.cancel();
          return { ok: false, status: res.status, reason: 'body exceeded size cap mid-stream', url: current };
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks);

    return {
      ok: true,
      status: res.status,
      url: current,
      contentType,
      body,
      text: contentType === 'application/pdf' ? null : body.toString('utf8'),
    };
  }

  return { ok: false, status: 0, reason: `exceeded ${LIMITS.maxRedirects} redirects`, url: current };
}

/* ------------------------------------------------------------------ */
/* Path safety                                                         */
/* ------------------------------------------------------------------ */

/** Rejects ids that could escape the data directory. */
export function assertSafeId(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) {
    throw new Error(`unsafe id "${id}": only lowercase letters, digits and hyphens are permitted`);
  }
  return id;
}

/** Detects a bot-challenge page wearing a legitimate domain. */
export function looksLikeChallenge(html) {
  if (!html) return false;
  const h = html.toLowerCase();
  return (
    h.includes('cf-browser-verification') ||
    h.includes('checking your browser before accessing') ||
    h.includes('just a moment...') ||
    h.includes('enable javascript and cookies to continue') ||
    h.includes('__cf_chl') ||
    (h.includes('captcha') && html.length < 6000)
  );
}
