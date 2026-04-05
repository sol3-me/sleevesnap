/**
 * Returns true when the URL is safe to fetch as a remote resource.
 *
 * Rules:
 *  - Must use the http: or https: scheme
 *  - Must not target loopback, link-local, or RFC-1918 private addresses
 *    (prevents server-side request forgery against internal services)
 */
export function isSafeExternalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  // Block loopback / localhost
  if (host === 'localhost' || host === '::1') return false;

  // Block IPv4 private / link-local ranges:
  //   10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8
  const privateIPv4 =
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (privateIPv4.test(host)) return false;

  // Block IPv6 ULA (fc00::/7) and link-local (fe80::/10) in bracket notation
  if (/^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host)) return false;

  return true;
}
