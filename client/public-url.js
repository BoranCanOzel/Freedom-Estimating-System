// Published links use TLS even when the current tab was opened over HTTP.
// Keep loopback HTTP usable for local development.
export function publicUrl(path, origin) {
  const url = new URL(path, origin);
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
    url.hostname === '[::1]' || /^127\./.test(url.hostname);
  if (url.protocol === 'http:' && !local) url.protocol = 'https:';
  return url.href;
}
