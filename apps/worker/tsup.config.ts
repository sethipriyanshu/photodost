import { defineConfig } from "tsup";

/**
 * The worker is bundled rather than plain-`tsc`-compiled.
 *
 * `@photodost/db` publishes TypeScript source (`main: ./src/index.ts`), which
 * Next transpiles happily but Node cannot load — and its internal imports are
 * extensionless (`./schema`), which Node's ESM resolver rejects outright. So a
 * `tsc`-built worker looked fine and then died on `node dist/index.js` with
 * ERR_MODULE_NOT_FOUND.
 *
 * Bundling the workspace package into the output fixes that without forcing
 * `packages/db` to be built before the web app can run in dev.
 *
 * Everything in node_modules stays external — `sharp` is a native module and
 * must not be bundled, and there's no size win from inlining the AWS SDK into a
 * long-running container.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  // Bundle the workspace package; leave real dependencies to node_modules.
  noExternal: ["@photodost/db"],
  clean: true,
  sourcemap: true,
  // Type errors are `pnpm typecheck`'s job (tsc --noEmit); no need to pay for
  // .d.ts emit on an application entrypoint.
  dts: false,
});
