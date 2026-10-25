import SwitchedOff from "@/components/SwitchedOff";
import { isOn } from "@/lib/launch-scope";

// Posting a friendly — switched off in this build (lib/launch-scope.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
  return isOn("friendlies") ? <>{children}</> : <SwitchedOff feature="friendlies" />;
}
