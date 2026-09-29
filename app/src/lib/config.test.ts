import { describe, expect, it } from '@jest/globals';

import { MCP_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, versionLabel } from './config';

describe('config', () => {
  it('points at the project and its MCP server over HTTPS', () => {
    expect(SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(MCP_URL).toBe(`${SUPABASE_URL}/functions/v1/mcp`);
  });

  it('holds only the public (publishable) key, never a secret one', () => {
    expect(SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')).toBe(true);
    expect(SUPABASE_PUBLISHABLE_KEY).not.toMatch(/secret|service_role/i);
  });
});

describe('versionLabel', () => {
  it('shows version and build', () => {
    expect(versionLabel('0.1.0', 1)).toBe('Version 0.1.0 (build 1)');
    expect(versionLabel('0.1.0')).toBe('Version 0.1.0');
    expect(versionLabel(null, 3)).toBe('Version unknown');
  });
});
