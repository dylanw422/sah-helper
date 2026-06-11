"use client";

import { useEffect, useState } from "react";

export function useScrollOpacity(threshold = 40) {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const handler = () => setOpacity(Math.min(window.scrollY / threshold, 1));
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [threshold]);
  return opacity;
}
