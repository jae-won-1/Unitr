// Leaving the current screen and dropping everything the app was holding.
//
// This exists so AuthContext can be shared with the React Native app. Its
// signOut needs to *navigate*, and navigation is the one thing a browser and a
// phone do completely differently — so the single differing line lives here
// rather than forcing a second copy of the whole context to be maintained
// alongside this one. Metro picks hard-navigate.native.ts on a phone; Next's
// bundler does not know that convention and keeps this file.
//
// "Hard" is the point: a full document load, not a router push. It drops every
// bit of user-scoped state the app is holding (role, team, cached queries)
// instead of leaving it for the next person to sign in on this device.
export function hardNavigate(to: string): void {
  window.location.assign(to);
}
