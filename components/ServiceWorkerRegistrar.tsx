"use client";

import { useEffect } from "react";

/*
 * Registers /sw.js in production only.
 *
 * In development the worker is actively unregistered instead: sw.js treats
 * /_next/static/* as immutable and serves it cache-first, which is true of a
 * production build but not of `next dev`, where those URLs change on every
 * recompile. A worker left over from a production build on the same origin
 * (e.g. localhost) would serve stale chunks and break HMR.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((reg) => reg.unregister()))
        .catch(() => {});
      return;
    }

    // Wait for load so the worker install doesn't contend with the first paint.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Registration failures are non-fatal: the app works fine uninstalled.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
