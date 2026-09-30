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
// TEST_TOP_UP — payments the web's way (user's call, 30 Sep: "make it work
//   like the web; grey or take them out before submitting"). Two places:
//     • "+ Top Up" beside the balance on the captain's Team Money;
//     • a shortfall in Challenge or Enter a tournament opens that Top Up,
//       pre-filled with the gap, then retries — instead of the named
//       "Pay £X towards your half of the pitch" that store builds show.
//   Kept out of store builds because a stored balance topped up by card reads
//   to Apple (and Google Play's equivalent payments policy) as a digital
//   wallet, which they can require to go through their own billing. Every
//   other payment on the phone is named for the real-world thing it pays for
//   (a joining fee, a pitch share, a buy-in), which is the exempt shape.
export const TEST_TOP_UP = __DEV__;
