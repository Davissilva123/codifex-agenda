"use client";

import { useEffect, useState } from "react";

type ClockListener = (now: Date) => void;

const listeners = new Set<ClockListener>();
let timer: ReturnType<typeof setInterval> | null = null;

export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const update: ClockListener = (next) => setNow(next);
    listeners.add(update);
    if (timer === null) {
      timer = setInterval(() => {
        const current = new Date();
        listeners.forEach((listener) => listener(current));
      }, 30000);
    }

    return () => {
      listeners.delete(update);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return now;
}
