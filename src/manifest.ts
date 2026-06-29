import { readTextFile, type DeployArchive } from "./archive.js";

export type AppManifest = {
  bindings?: Record<string, unknown>;
  schedules?: Array<{ cron: string; path: string }>;
  queues?: string[];
  vars?: string[];
  secrets?: string[];
};

export const readAppManifest = (archive: DeployArchive): AppManifest => {
  const source = readTextFile(archive, "w7s.json");
  if (!source) return {};
  try {
    const parsed = JSON.parse(source) as AppManifest;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Unable to parse w7s.json: ${reason}`);
  }
};

export const readCustomDomains = (archive: DeployArchive) => {
  const source = readTextFile(archive, "CNAME");
  if (!source) return [];
  return source
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#"));
};
