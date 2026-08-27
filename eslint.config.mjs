import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Both components read `window.location.hash` — the decryption key — which
    // only exists on the client. Doing that in an effect and calling setState
    // is the conventional pattern, and this rule (a cascading-render *perf*
    // guard, not a correctness one) flags it. Each page renders the value once,
    // so there is no cascade to avoid.
    //
    // The idiomatic modern fix is useSyncExternalStore. Worth doing, but it
    // changes hydration behaviour on the two pages that handle secrets, so it
    // wants browser testing rather than a drive-by edit. Scoped narrowly here
    // so the rule still applies to all new code.
    files: ["components/CreatedView.tsx", "components/RevealView.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
