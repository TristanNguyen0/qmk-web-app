import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source, so Next must compile them.
  transpilePackages: ['@qmk-web-app/domain'],
  // Next writes CLAUDE.md/AGENTS.md by default. This repo already has a hand-written
  // claude.md operating guide at the root, and on a case-insensitive filesystem that
  // generation would collide with it. Off.
  agentRules: false,
};

export default config;
