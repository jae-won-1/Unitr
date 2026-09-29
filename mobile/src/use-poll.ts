// Run `fn` every `ms` while the app is in the foreground.
//
// The web team chat polls every 5s and pauses when the tab is hidden
// (document.hidden). A phone has no tab, so AppState is the equivalent: nothing
// is fetched while the app is backgrounded, and coming back to it fetches once
// straight away rather than waiting out the interval.
//
// Polling rather than Supabase realtime because realtime isn't enabled on this
// project — same reason as the web.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export function usePoll(fn: () => void | Promise<void>, ms: number, enabled = true) {
  // Always call the latest fn without restarting the timer on every render.
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void latest.current(), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void latest.current();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [ms, enabled]);
}
