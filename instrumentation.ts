export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { deleteExpired } = await import("./lib/sweeper");

  // Run once at boot, then every minute.
  try {
    const n = deleteExpired();
    if (n > 0) console.log(`[sweeper] removed ${n} expired secret(s) at boot`);
  } catch (e) {
    console.error("[sweeper] boot run failed:", e);
  }

  const interval = setInterval(() => {
    try {
      const n = deleteExpired();
      if (n > 0) console.log(`[sweeper] removed ${n} expired secret(s)`);
    } catch (e) {
      console.error("[sweeper] error:", e);
    }
  }, 60_000);
  interval.unref?.();
}
