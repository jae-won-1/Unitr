// Features that are ON while testing and OFF in anything sent to the App Store
// or Play Store.
//
// `__DEV__` is true only when the app runs from `npx expo start` (Expo Go or a
// dev build) and false in every release build, so a store build can't ship one
// of these by accident. Nothing here needs remembering to switch off.
//
// Before a store submission, decide each one for real (see mobile/PORTED.md,
// the Wording note):
//
// TEST_TOP_UP — the web's free-amount "+ Top Up" on the captain's Team Money.
//   Kept out of store builds because a stored balance topped up by card reads
//   to Apple (and Google Play's equivalent payments policy) as a digital
//   wallet, which they can require to go through their own billing. Every
//   other payment on the phone is named for the real-world thing it pays for
//   (a joining fee, a pitch share, a buy-in), which is the exempt shape.
export const TEST_TOP_UP = __DEV__;
