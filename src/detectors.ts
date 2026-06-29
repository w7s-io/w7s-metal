import type { DeployArchive } from "./archive.js";

export const staticRoots = ["dist/client", "frontend/dist", "dist", "build", "out", "public"];
export const workerEntrypoints = ["worker/index.ts", "worker/index.js", "backend/index.ts", "backend/index.js", "dist/server/index.js"];

export const detectStaticRoot = (archive: DeployArchive) =>
  staticRoots.find((root) => archive.files.has(`${root}/index.html`)) ?? null;

export const detectWorkerEntrypoint = (archive: DeployArchive) =>
  workerEntrypoints.find((entrypoint) => archive.files.has(entrypoint)) ?? null;
