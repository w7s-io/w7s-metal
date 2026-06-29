#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { listen } from "./server.js";

const usage = () => {
  console.log(`w7s-metal

Usage:
  w7s-metal serve
  w7s-metal init
  w7s-metal doctor

Environment:
  W7S_METAL_BASE_DOMAIN   Base domain for deployed apps.
  W7S_METAL_DATA_DIR      Data directory. Defaults to ~/.local/share/w7s-metal.
  W7S_METAL_HOST          Bind host. Defaults to 0.0.0.0.
  W7S_METAL_PORT          Bind port. Defaults to 8787.
  W7S_METAL_DEPLOY_TOKEN  Optional shared deploy token for the MVP endpoint.
`);
};

const init = async () => {
  const config = loadConfig();
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(path.join(config.dataDir, "deployments"), { recursive: true });
  await fs.mkdir(path.join(config.dataDir, "workerd"), { recursive: true });
  console.log(`Initialized W7S Metal data directory at ${config.dataDir}`);
};

const doctor = async () => {
  const config = loadConfig();
  const checks = [
    ["data dir", config.dataDir],
    ["base domain", config.baseDomain],
    ["listen", `${config.host}:${config.port}`],
    ["deploy token", config.deployToken ? "configured" : "not configured"]
  ];
  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
};

const main = async () => {
  const command = process.argv[2] || "help";
  if (command === "serve") {
    const config = loadConfig();
    await listen(config);
    console.log(`w7s-metal listening on http://${config.host}:${config.port}`);
    console.log(`base domain: ${config.baseDomain}`);
    return;
  }
  if (command === "init") {
    await init();
    return;
  }
  if (command === "doctor") {
    await doctor();
    return;
  }
  usage();
  if (command !== "help" && command !== "--help" && command !== "-h") process.exitCode = 1;
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
