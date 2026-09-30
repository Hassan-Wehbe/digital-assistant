// Guards for app.json that only a phone would otherwise reveal.
import { describe, expect, it } from '@jest/globals';

import app from '../../app.json';
import pkg from '../../package.json';

const blocked: string[] = app.expo.android.blockedPermissions;
const deps = Object.keys(pkg.dependencies);

describe('app.json', () => {
  it('keeps the permission expo-screen-capture needs when the app starts (Android 14+)', () => {
    // Its module registers Activity.registerScreenCaptureCallback as the app starts, which
    // throws without DETECT_SCREEN_CAPTURE: blocking it crashed the app at launch (A3a builds).
    // It is a normal permission: granted at install, never asked, no access to photos or files.
    if (deps.includes('expo-screen-capture')) expect(blocked).not.toContain('android.permission.DETECT_SCREEN_CAPTURE');
  });

  it('still blocks storage, microphone and drawing over other apps', () => {
    for (const p of ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'RECORD_AUDIO', 'SYSTEM_ALERT_WINDOW', 'READ_MEDIA_IMAGES']) {
      expect(blocked).toContain(`android.permission.${p}`);
    }
  });
});
