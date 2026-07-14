"use client";

import { useEffect } from "react";

export function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // O app continua funcionando mesmo se o navegador bloquear o service worker.
    });
  }, []);

  return null;
}
