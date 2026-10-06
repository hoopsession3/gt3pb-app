import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `npm run smoke` compiles lib/*.ts into .smoke/ and removes it on success. When a later link
    // in `npm test` fails, the folder stays — and the lint ratchet then counted 28 "new" problems
    // in compiled output (2026-10-02). A build artifact must not move the lint count.
    ".smoke/**",
    // THE IPHONE APP (2026-10-06): its native project, which holds a copy of the export after
    // `npx cap sync ios` (ios/App/App/public — git ignores it, the linter did not, and counted 6,157
    // problems in minified output), and the build's own working copy while it builds.
    "ios/**",
    ".app-build/**",
  ]),

  // COMMONJS FILES ARE COMMONJS.
  //
  // 39 of this repo's lint errors — one in six — were "A `require()` style import is forbidden",
  // every one of them in a file Node itself loads as CommonJS. package.json declares no
  // "type": "module", so .cjs and scripts/*.js are CJS by Node's own resolution rules and require()
  // is the ONLY import form available in them. The rule could not be satisfied there. It was not
  // reporting a defect; it was reporting the file extension.
  //
  // That is not free. Every round of this audit added three or four errors to the repo total for
  // the correct act of writing another test, and a number that goes up when you do the right thing
  // is a number people stop reading. Scoped OFF here, and only here — .ts/.tsx still error on
  // require(), which is where the rule means something.
  {
    files: ["**/*.cjs", "scripts/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
