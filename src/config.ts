import os from "node:os";
import path from "node:path";

export type MetalConfig = {
  baseDomain: string;
  dataDir: string;
  host: string;
  port: number;
  deployToken?: string;
  publicUrl?: string;
  appProtocol: "http" | "https";
  workerdPath?: string;
  workerdHost: string;
  workerdPortBase: number;
};

const defaultDataDir = () => path.join(os.homedir(), ".local", "share", "w7s-metal");

export const loadConfig = (): MetalConfig => ({
  baseDomain: process.env.W7S_METAL_BASE_DOMAIN?.trim() || "localhost",
  dataDir: process.env.W7S_METAL_DATA_DIR?.trim() || defaultDataDir(),
  host: process.env.W7S_METAL_HOST?.trim() || "0.0.0.0",
  port: Number.parseInt(process.env.W7S_METAL_PORT || "8787", 10),
  deployToken: process.env.W7S_METAL_DEPLOY_TOKEN?.trim() || undefined,
  publicUrl: process.env.W7S_METAL_PUBLIC_URL?.trim() || undefined,
  appProtocol: process.env.W7S_METAL_APP_PROTOCOL === "http" ? "http" : "https",
  workerdPath: process.env.W7S_METAL_WORKERD_PATH?.trim() || undefined,
  workerdHost: process.env.W7S_METAL_WORKERD_HOST?.trim() || "127.0.0.1",
  workerdPortBase: Number.parseInt(process.env.W7S_METAL_WORKERD_PORT_BASE || "19000", 10)
});
