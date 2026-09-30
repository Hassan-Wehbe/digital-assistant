// Links that open the app from outside. iOS's share extension opens "wilma://dataUrl=..."
// (iOS sharing is switched off in app.json until phase B); send it to the share screen
// instead of a "page not found". Android shares arrive without a link.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  return path.includes('dataUrl=') ? '/share' : path;
}
