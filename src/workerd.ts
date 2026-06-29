import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { MetalConfig } from "./config.js";
import { deploymentPath, type DeploymentRecord, type Store } from "./storage.js";

const require = createRequire(import.meta.url);
const compatibilityDate = "2025-09-24";

export type WorkerdPlan = {
  enabled: boolean;
  configPath: string | null;
  port: number | null;
  status: "disabled" | "ready" | "planned";
  message: string;
};

type RuntimeState = {
  child: ChildProcess;
  origin: string;
  configPath: string;
  startedAt: string;
};

const runtimes = new Map<string, RuntimeState>();

const capnpText = (value: string) => JSON.stringify(value);

export const isJavaScriptEntrypoint = (entrypoint: string) =>
  entrypoint.endsWith(".js") || entrypoint.endsWith(".mjs");

const stablePort = (config: MetalConfig, record: DeploymentRecord) => {
  const key = `${record.ownerSlug}/${record.repoSlug}/${record.environment}`;
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return config.workerdPortBase + (hash % 30000);
};

const resolveWorkerdBinary = (explicit?: string) => {
  if (explicit) return explicit;
  try {
    return require.resolve("workerd/bin/workerd");
  } catch {
    return process.platform === "win32" ? "workerd.cmd" : "workerd";
  }
};

const renderBinding = (name: string, value: string) =>
  `(name = ${capnpText(name)}, text = ${capnpText(value)})`;

const renderConfig = (params: {
  record: DeploymentRecord;
  bundleDir: string;
  entrypoint: string;
  host: string;
  port: number;
}) => {
  const bindings = [
    renderBinding("W7S_OWNER", params.record.ownerSlug),
    renderBinding("W7S_REPO", params.record.repoSlug),
    renderBinding("W7S_REPOSITORY", params.record.repository),
    renderBinding("W7S_ENVIRONMENT", params.record.environment)
  ];

  for (const name of params.record.manifest.vars ?? []) {
    const value = process.env[name];
    if (value !== undefined) bindings.push(renderBinding(name, value));
  }
  for (const name of params.record.manifest.secrets ?? []) {
    const value = process.env[name];
    if (value !== undefined) bindings.push(renderBinding(name, value));
  }

  const moduleName = params.entrypoint.replace(/\\/g, "/");
  const modulePath = path.posix.join("bundle", moduleName);

  return [
    `using Workerd = import "/workerd/workerd.capnp";`,
    ``,
    `const config :Workerd.Config = (`,
    `  services = [`,
    `    (name = "main", worker = (`,
    `      modules = [(name = ${capnpText(moduleName)}, esModule = embed ${capnpText(modulePath)})],`,
    `      compatibilityDate = ${capnpText(compatibilityDate)},`,
    `      bindings = [${bindings.join(", ")}]`,
    `    ))`,
    `  ],`,
    `  sockets = [`,
    `    (name = "http", address = ${capnpText(`${params.host}:${params.port}`)}, http = (), service = "main")`,
    `  ]`,
    `);`
  ].join("\n");
};

const waitForPort = async (host: string, port: number, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.setTimeout(250, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workerd did not become ready on ${host}:${port}.`);
};

export const writeWorkerdPlan = async (
  store: Store,
  record: DeploymentRecord,
  config?: MetalConfig
): Promise<WorkerdPlan> => {
  if (!record.workerEntrypoint) {
    return {
      enabled: false,
      configPath: null,
      port: null,
      status: "disabled",
      message: "No Worker entrypoint detected for this deployment."
    };
  }

  const dir = path.join(store.dataDir, "workerd", record.ownerSlug, record.repoSlug, record.environment);
  await fs.mkdir(dir, { recursive: true });
  const planPath = path.join(dir, "workerd.plan.json");
  const port = config ? stablePort(config, record) : null;
  const jsReady = isJavaScriptEntrypoint(record.workerEntrypoint);

  await fs.writeFile(
    planPath,
    `${JSON.stringify(
      {
        repository: record.repository,
        environment: record.environment,
        entrypoint: record.workerEntrypoint,
        bundleDir: path.join(deploymentPath(store, record), "worker"),
        port,
        status: jsReady ? "ready-to-run" : "needs-javascript-entrypoint",
        note: "W7S Metal runs JavaScript Worker entrypoints with workerd. TypeScript entrypoints must be built to JavaScript before deployment."
      },
      null,
      2
    )}\n`
  );

  return {
    enabled: jsReady,
    configPath: planPath,
    port,
    status: jsReady ? "ready" : "planned",
    message: jsReady
      ? "Worker entrypoint captured and ready for workerd execution."
      : "Worker entrypoint captured, but TypeScript execution is not supported yet. Build the backend to JavaScript before deploying."
  };
};

export const ensureWorkerdRuntime = async (params: {
  store: Store;
  config: MetalConfig;
  record: DeploymentRecord;
}) => {
  const { store, config, record } = params;
  if (!record.workerEntrypoint) throw new Error("Deployment has no Worker entrypoint.");
  if (!isJavaScriptEntrypoint(record.workerEntrypoint)) {
    throw new Error("W7S Metal workerd runtime currently requires a JavaScript Worker entrypoint.");
  }

  const key = record.id;
  const existing = runtimes.get(key);
  if (existing && !existing.child.killed && existing.child.exitCode === null) return existing.origin;

  const dir = path.join(store.dataDir, "workerd", record.ownerSlug, record.repoSlug, record.environment);
  await fs.mkdir(dir, { recursive: true });
  const bundleDir = path.join(deploymentPath(store, record), "worker");
  const runtimeBundleDir = path.join(dir, "bundle");
  await fs.rm(runtimeBundleDir, { recursive: true, force: true });
  await fs.cp(bundleDir, runtimeBundleDir, { recursive: true });
  const port = stablePort(config, record);
  const configPath = path.join(dir, "config.capnp");
  await fs.writeFile(
    configPath,
    renderConfig({
      record,
      bundleDir,
      entrypoint: record.workerEntrypoint,
      host: config.workerdHost,
      port
    }),
    "utf8"
  );

  const workerd = resolveWorkerdBinary(config.workerdPath);
  const child = spawn(workerd, ["serve", configPath, "config"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });

  child.stdout?.on("data", (chunk) => process.stdout.write(`[workerd ${record.repository} ${record.environment}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[workerd ${record.repository} ${record.environment}] ${chunk}`));
  child.once("exit", () => {
    const current = runtimes.get(key);
    if (current?.child === child) runtimes.delete(key);
  });

  const origin = `http://${config.workerdHost}:${port}`;
  runtimes.set(key, {
    child,
    origin,
    configPath,
    startedAt: new Date().toISOString()
  });

  try {
    await waitForPort(config.workerdHost, port);
  } catch (error) {
    child.kill("SIGTERM");
    runtimes.delete(key);
    throw error;
  }

  return origin;
};

export const stopWorkerdRuntimes = () => {
  for (const runtime of runtimes.values()) {
    if (!runtime.child.killed && runtime.child.exitCode === null) {
      runtime.child.kill("SIGTERM");
    }
  }
  runtimes.clear();
};
