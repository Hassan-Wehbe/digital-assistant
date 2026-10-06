// Guards for app.json that only a phone would otherwise reveal.
import { describe, expect, it } from '@jest/globals';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import app from '../../app.json';
import pkg from '../../package.json';

const blocked: string[] = app.expo.android.blockedPermissions;
const deps = Object.keys(pkg.dependencies);
const pluginOptions = (name: string): Record<string, unknown> | undefined => {
  for (const p of app.expo.plugins as unknown[]) {
    if (p === name) return {};
    if (Array.isArray(p) && p[0] === name) return (p[1] ?? {}) as Record<string, unknown>;
  }
  return undefined;
};

describe('app.json', () => {
  it('keeps the permission expo-screen-capture needs when the app starts (Android 14+)', () => {
    // Its module registers Activity.registerScreenCaptureCallback as the app starts, which
    // throws without DETECT_SCREEN_CAPTURE: blocking it crashed the app at launch (A3a builds).
    // It is a normal permission: granted at install, never asked, no access to photos or files.
    if (deps.includes('expo-screen-capture')) expect(blocked).not.toContain('android.permission.DETECT_SCREEN_CAPTURE');
  });

  it('still blocks storage, media and drawing over other apps', () => {
    for (const p of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW', 'READ_MEDIA_IMAGES']) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
  });

  it('allows the microphone only for dictation (A5e)', () => {
    if (!deps.includes('expo-speech-recognition')) {
      expect(blocked).toContain('android.permission.RECORD_AUDIO');
      return;
    }
    expect(blocked).not.toContain('android.permission.RECORD_AUDIO');
    expect(pluginOptions('expo-speech-recognition')).toBeDefined();
    // expo-image-picker's `microphonePermission: false` puts RECORD_AUDIO back on the blocked
    // list itself (its config plugin), which would remove it from the manifest and leave the
    // mic unable to ever get permission. The picker stays photo-only instead (next test).
    expect(pluginOptions('expo-image-picker')?.microphonePermission).not.toBe(false);
  });

  it('allows the location only while the app is in use, never in the background (places step 5)', () => {
    for (const p of ['ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE_LOCATION', 'ACTIVITY_RECOGNITION']) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
    expect(blocked).not.toContain('android.permission.ACCESS_FINE_LOCATION');
    const opts = pluginOptions('expo-location');
    expect(opts).toBeDefined();
    expect(opts?.isAndroidBackgroundLocationEnabled).toBe(false);
    expect(opts?.isAndroidForegroundServiceEnabled).toBe(false);
    expect(opts?.isIosBackgroundLocationEnabled).toBe(false);
  });

  it('never lets the image picker record video (it would use the microphone)', () => {
    const src = readFileSync(resolve(__dirname, 'deviceFiles.ts'), 'utf8');
    const calls = src.match(/launch(Camera|ImageLibrary)Async\(\{[^}]*\}/g) ?? [];
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c).toMatch(/mediaTypes: \['images'\]/);
    expect(src).not.toMatch(/videos|livePhotos|MediaType(Options)?\.(Videos|All)/);
  });
});

// The modules a file can reach through its own imports (relative and "@/"), not packages.
const SRC = resolve(__dirname, '..');
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (/\.tsx?$/.test(base + ext) && existsSync(base + ext)) return base + ext;
  }
  return null;
}
function reachable(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm)) {
      const next = resolveImport(f, m[1]);
      if (next) todo.push(next);
      else if (!m[1].startsWith('.') && !m[1].startsWith('@/')) packages.add(m[1]);
    }
  }
  return { files, packages };
}

describe('no microphone on secret screens (A5e Q4, CLAUDE.md rules 1 and 9)', () => {
  const vault = readdirSync(join(SRC, 'app/vault')).map((f) => join(SRC, 'app/vault', f));
  const screens = [
    ...vault,
    join(SRC, 'app/sign-in.tsx'),
    join(SRC, 'app/account.tsx'),
    join(SRC, 'components/PassphraseInput.tsx'),
    join(SRC, 'components/SecretFieldsForm.tsx'),
    join(SRC, 'components/UnlockCard.tsx'),
  ];

  it.each(screens.map((s) => [s.slice(SRC.length + 1), s]))('%s cannot reach dictation', (_name, file) => {
    const { files, packages } = reachable(file);
    const names = [...files].map((f) => f.slice(SRC.length + 1));
    expect(names).not.toContain('lib/voice.ts');
    expect(names.some((n) => /(^|\/)MicButton\.tsx$/.test(n))).toBe(false);
    expect([...packages]).not.toContain('expo-speech-recognition');
  });
});

describe('the speech package is loaded only by lib/voice.ts, and only on first use', () => {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) all.push(p);
    }
  };
  walk(SRC);

  it('no other app file mentions it', () => {
    const users = all.filter((f) => readFileSync(f, 'utf8').includes('expo-speech-recognition'));
    expect(users.map((f) => f.slice(SRC.length + 1))).toEqual(['lib/voice.ts']);
  });

  it('voice.ts imports it only as types, or with a require() inside a function', () => {
    const src = readFileSync(join(SRC, 'lib/voice.ts'), 'utf8');
    const lines = src.split('\n').filter((l) => l.includes("'expo-speech-recognition'") && !l.trim().startsWith('//'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^import type |^type .*import\('expo-speech-recognition'\)|^\s+const \w+(: \w+)? = require\('expo-speech-recognition'\)/);
  });
});

describe('the location package is loaded only by lib/location.ts, and only on use', () => {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) all.push(p);
    }
  };
  walk(SRC);

  it('no other app file mentions it', () => {
    const users = all.filter((f) => readFileSync(f, 'utf8').includes('expo-location'));
    expect(users.map((f) => f.slice(SRC.length + 1))).toEqual(['lib/location.ts']);
  });

  it('location.ts imports it only as types, or with a require() inside a function', () => {
    const src = readFileSync(join(SRC, 'lib/location.ts'), 'utf8');
    const lines = src.split('\n').filter((l) => l.includes("'expo-location'") && !l.trim().startsWith('//'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^type \w+ = typeof import\('expo-location'\);$|^\s+const \w+(: \w+)? = require\('expo-location'\);$/);
  });

  it('never asks for or reads the location in the background', () => {
    const src = readFileSync(join(SRC, 'lib/location.ts'), 'utf8');
    expect(src).not.toMatch(/Background|watchPosition|startLocationUpdates|Geofencing/);
  });
});
