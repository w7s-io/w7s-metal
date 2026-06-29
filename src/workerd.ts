import fs from "node:fs/promises";
import path from "node:path";
import type { DeploymentRecord, Store } from "./storage.js";

export type WorkerdPlan = {
  enabled: boolean;
  configPath: string | null;
  message: string;
};

export const writeWorkerdPlan = async (store: Store, record: DeploymentRecord): Promise<WorkerdPlan> => {
  if (!record.workerEntrypoint) {
    return {
      enabled: false,
      configPath: null,
      message: "No Worker entrypoint detected for this deployment."
    };
  }

  const dir = path.join(store.dataDir, "workerd", record.ownerSlug, record.repoSlug, record.environment);
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, "workerd.plan.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        repository: record.repository,
        environment: record.environment,
        entrypoint: record.workerEntrypoint,
        bundleDir: path.join(store.dataDir, "deployments", record.ownerSlug, record.repoSlug, record.environment, "worker"),
        status: "planned",
        note: "This is the W7S Metal runtime handoff. The next milestone turns this plan into generated workerd config and a supervised workerd process."
      },
      null,
      2
    )}\n`
  );

  return {
    enabled: true,
    configPath,
    message: "Worker entrypoint captured and workerd runtime plan written."
  };
};
