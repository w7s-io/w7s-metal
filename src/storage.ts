import fs from "node:fs/promises";
import path from "node:path";
import type { DeployArchive } from "./archive.js";
import type { AppManifest } from "./manifest.js";

export type DeploymentRecord = {
  id: string;
  repository: string;
  owner: string;
  repo: string;
  ownerSlug: string;
  repoSlug: string;
  branch: string;
  environment: string;
  commitSha: string;
  deployedAt: string;
  url: string;
  staticRoot: string | null;
  staticFileCount: number;
  workerEntrypoint: string | null;
  customDomains: string[];
  manifest: AppManifest;
};

export type Store = {
  dataDir: string;
};

export const createStore = async (dataDir: string): Promise<Store> => {
  await fs.mkdir(path.join(dataDir, "deployments"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "static"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "workers"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "workerd"), { recursive: true });
  return { dataDir };
};

const deploymentDir = (store: Store, record: Pick<DeploymentRecord, "ownerSlug" | "repoSlug" | "environment">) =>
  path.join(store.dataDir, "deployments", record.ownerSlug, record.repoSlug, record.environment);

export const writeDeploymentRecord = async (store: Store, record: DeploymentRecord) => {
  const dir = deploymentDir(store, record);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "deployment.json"), `${JSON.stringify(record, null, 2)}\n`);
};

export const readDeploymentRecord = async (
  store: Store,
  ownerSlug: string,
  repoSlug: string,
  environment: string
) => {
  try {
    const source = await fs.readFile(path.join(deploymentDir(store, { ownerSlug, repoSlug, environment }), "deployment.json"), "utf8");
    return JSON.parse(source) as DeploymentRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

export const listDeploymentRecords = async (store: Store) => {
  const root = path.join(store.dataDir, "deployments");
  const records: DeploymentRecord[] = [];

  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name === "deployment.json") {
        records.push(JSON.parse(await fs.readFile(fullPath, "utf8")) as DeploymentRecord);
      }
    }
  };

  try {
    await walk(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return records.sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
};

export const writeStaticFiles = async (
  store: Store,
  record: Pick<DeploymentRecord, "ownerSlug" | "repoSlug" | "environment">,
  archive: DeployArchive,
  staticRoot: string
) => {
  const targetDir = path.join(deploymentDir(store, record), "static");
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });

  let count = 0;
  const prefix = `${staticRoot.replace(/\/$/, "")}/`;
  for (const entry of archive.entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    if (!relative) continue;
    const target = path.join(targetDir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.bytes);
    count += 1;
  }

  return count;
};

export const writeWorkerBundle = async (
  store: Store,
  record: Pick<DeploymentRecord, "ownerSlug" | "repoSlug" | "environment">,
  archive: DeployArchive,
  entrypoint: string
) => {
  const targetDir = path.join(deploymentDir(store, record), "worker");
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });

  const prefixes = ["worker/", "backend/", "dist/server/"];
  for (const entry of archive.entries) {
    if (!prefixes.some((prefix) => entry.path.startsWith(prefix))) continue;
    const target = path.join(targetDir, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.bytes);
  }

  return path.join(targetDir, entrypoint);
};

export const staticFilePath = (store: Store, record: DeploymentRecord, requestPath: string) =>
  path.join(deploymentDir(store, record), "static", requestPath);
