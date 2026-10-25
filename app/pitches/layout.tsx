import SwitchedOff from "@/components/SwitchedOff";
import { isOn } from "@/lib/launch-scope";

// Browsing and registering pitches — switched off in this build (lib/launch-scope.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
  return isOn("pitchBooking") ? <>{children}</> : <SwitchedOff feature="pitchBooking" />;
}
