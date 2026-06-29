import { unzipSync } from "fflate";

export type ArchiveEntry = {
  path: string;
  bytes: Uint8Array;
};

export type DeployArchive = {
  entries: ArchiveEntry[];
  files: Map<string, Uint8Array>;
  compressedBytes: number;
  uncompressedBytes: number;
};

const decoder = new TextDecoder();

export const normalizeArchivePath = (value: string) => {
  const parts: string[] = [];
  value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .split("/")
    .forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") {
        parts.pop();
        return;
      }
      parts.push(part);
    });
  return parts.join("/");
};

const stripCommonRoot = (entries: ArchiveEntry[]) => {
  const platformRoots = new Set(["worker", "frontend", "backend", "dist", "build", "out", "db", ".github"]);
  const topLevels = new Set<string>();
  let allNested = entries.length > 0;

  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (parts.length < 2) {
      allNested = false;
      break;
    }
    topLevels.add(parts[0] ?? "");
  }

  if (!allNested || topLevels.size !== 1) return entries;
  const root = [...topLevels][0] ?? "";
  if (!root || platformRoots.has(root)) return entries;

  return entries.map((entry) => ({
    path: entry.path.slice(root.length + 1),
    bytes: entry.bytes
  }));
};

export const readDeployArchive = (bytes: Uint8Array): DeployArchive => {
  if (bytes.byteLength === 0) throw new Error("Deploy archive is empty.");

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid zip";
    throw new Error(`Unable to read deploy archive: ${reason}`);
  }

  const rawEntries = Object.entries(unzipped)
    .filter(([path]) => !path.replace(/\\/g, "/").endsWith("/"))
    .map(([path, entryBytes]) => ({
      path: normalizeArchivePath(path),
      bytes: entryBytes
    }))
    .filter((entry) => entry.path);

  const entries = stripCommonRoot(rawEntries).filter((entry) => entry.path);
  return {
    entries,
    files: new Map(entries.map((entry) => [entry.path, entry.bytes])),
    compressedBytes: bytes.byteLength,
    uncompressedBytes: entries.reduce((total, entry) => total + entry.bytes.byteLength, 0)
  };
};

export const readTextFile = (archive: DeployArchive, path: string) => {
  const bytes = archive.files.get(normalizeArchivePath(path));
  return bytes ? decoder.decode(bytes) : null;
};
