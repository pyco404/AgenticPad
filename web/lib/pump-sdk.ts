import { existsSync } from "node:fs";
import { resolve } from "node:path";

// SDK 2.0's ESM dependency chain exposes Anchor BN incorrectly under native
// Node ESM. Its published CommonJS entry works; keep it on the server only.
const nodeModules = process.getBuiltinModule("node:module") as typeof import("node:module");
// Resolve from the runtime working directory, rather than a build-machine
// import.meta URL that a bundler could embed in its production output.
const cwd = process.cwd();
const moduleRoot = existsSync(resolve(cwd, "node_modules/@pump-fun/pump-sdk/package.json")) ? cwd : resolve(cwd, "web");
const sdkRequire = nodeModules.createRequire(resolve(moduleRoot, "package.json"));
export const pump = sdkRequire("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
