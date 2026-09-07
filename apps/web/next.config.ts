import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

/**
 * Hosts allowed to load dev-only resources (HMR, the dev overlay).
 *
 * `next dev` listens on every interface, so the app is normally opened from another
 * machine — `http://<this-host>:3000`. Next blocks dev resources for any origin it
 * was not told about, which silently disables hot reload. Rather than pin an address
 * that DHCP can change, allow the addresses this machine actually answers on;
 * `QWA_DEV_ORIGINS` (comma-separated) adds names those do not cover, such as an mDNS
 * hostname or a tunnel. Development only — `next build` and `next start` ignore it.
 */
function devOrigins(): string[] {
  const origins = new Set<string>();

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      // Link-local IPv6 needs a zone index to be reachable and is never what a
      // browser has in its address bar, so it would only pad the list.
      if (address.internal || address.address.toLowerCase().startsWith('fe80:')) continue;
      origins.add(address.address);
    }
  }

  for (const host of (process.env['QWA_DEV_ORIGINS'] ?? '').split(',')) {
    const trimmed = host.trim();
    if (trimmed) origins.add(trimmed);
  }

  return [...origins];
}

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source, so Next must compile them.
  transpilePackages: ['@qmk-web-app/domain'],
  // Next writes CLAUDE.md/AGENTS.md by default. This repo already has a hand-written
  // claude.md operating guide at the root, and on a case-insensitive filesystem that
  // generation would collide with it. Off.
  agentRules: false,
  allowedDevOrigins: devOrigins(),
};

export default config;
