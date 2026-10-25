import SwitchedOff from "@/components/SwitchedOff";
import { isOn } from "@/lib/launch-scope";

// A team hosting its own tournament — switched off in this build (lib/launch-scope.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
  return isOn("teamAndVenueEvents") ? <>{children}</> : <SwitchedOff feature="teamAndVenueEvents" />;
}
