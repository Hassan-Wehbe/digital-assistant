// "Save where I am" (docs/places-plan.md step 5): one reading of the phone's location, only when
// the person taps the button, never in the background. The permission is asked on that tap and
// only when it is not already given (asking again for a permission already given pauses the
// app on some phones: the mic bug fixed in #91). The coordinates go only into that place note.
//
// The package is loaded on first use (a require inside a function), as voice.ts does, so the
// rest of the app never touches it. The logic takes its phone calls as `deps`, so it is tested
// without a phone.

export interface Here {
  lat: number;
  lng: number;
  /** Metres, when the phone says. */
  accuracy: number | null;
}

export interface LocationDeps {
  permission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  askPermission: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  servicesOn: () => Promise<boolean>;
  position: () => Promise<{ latitude: number; longitude: number; accuracy: number | null }>;
}

export const LOCATION_TIMEOUT_MS = 20_000;

export const NO_PERMISSION = 'Wilma may not use your location. To allow it: phone Settings → Apps → Wilma → Permissions → Location → “Allow only while using the app”.';
export const SERVICES_OFF = 'Location is turned off on this phone. Turn it on (swipe down from the top of the screen), then try again.';
export const NOT_FOUND = 'Could not find where you are. Try again, near a window or outside.';

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Where the phone is, or a sentence saying why not. Asks for the permission only when needed. */
export async function whereAmI(deps: LocationDeps, timeoutMs = LOCATION_TIMEOUT_MS): Promise<{ here: Here } | { error: string }> {
  try {
    let p = await deps.permission();
    if (!p.granted && p.canAskAgain) p = await deps.askPermission();
    if (!p.granted) return { error: NO_PERMISSION };
    if (!(await deps.servicesOn())) return { error: SERVICES_OFF };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((done) => {
      timer = setTimeout(() => done(null), timeoutMs);
    });
    const pos = await Promise.race([deps.position(), late]).finally(() => clearTimeout(timer));
    if (!pos) return { error: NOT_FOUND };
    const { latitude: lat, longitude: lng, accuracy } = pos;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: NOT_FOUND };
    return { here: { lat: round(lat), lng: round(lng), accuracy: accuracy != null && Number.isFinite(accuracy) ? Math.round(accuracy) : null } };
  } catch {
    return { error: NOT_FOUND };
  }
}

/** "33.893791, 35.501778" */
export const coordsText = (h: { lat: number; lng: number }) => `${h.lat.toFixed(6)}, ${h.lng.toFixed(6)}`;

type LocationPackage = typeof import('expo-location');

/** The phone's location calls (expo-location, loaded on first use). */
export const deviceLocation: LocationDeps = {
  permission: () => pkg().getForegroundPermissionsAsync(),
  askPermission: () => pkg().requestForegroundPermissionsAsync(),
  servicesOn: () => pkg().hasServicesEnabledAsync(),
  position: async () => {
    const loc = pkg();
    const { coords } = await loc.getCurrentPositionAsync({ accuracy: loc.Accuracy.High });
    return { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
  },
};

function pkg(): LocationPackage {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loc: LocationPackage = require('expo-location');
  return loc;
}
