import http from "node:http";
import { loadConfig, type MetalConfig } from "./config.js";
import { handleDeployRequest } from "./deploy.js";
import { json, readBody, text } from "./http.js";
import { serveStaticRoute, routeSummary } from "./router.js";
import { createStore, type Store } from "./storage.js";

const commitHash = process.env.W7S_METAL_COMMIT_HASH || "local";
const branch = process.env.W7S_METAL_BRANCH || "local";
const deployedAt = process.env.W7S_METAL_DEPLOYED_AT || new Date().toISOString();

export type MetalServer = {
  config: MetalConfig;
  store: Store;
  server: http.Server;
};

export const createMetalServer = async (config = loadConfig()): Promise<MetalServer> => {
  const store = await createStore(config.dataDir);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/v1/health")) {
        json(response, 200, {
          ok: true,
          service: "w7s-metal",
          branch,
          commitHash,
          deployedAt,
          baseDomain: config.baseDomain
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/v1/routes") {
        json(response, 200, {
          status: "success",
          data: {
            routes: await routeSummary(store, config)
          }
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/deploy") {
        const body = await readBody(request);
        const result = await handleDeployRequest({ request, body, url, config, store });
        json(response, result.statusCode, result.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/v1/deploy/status") {
        json(response, 200, {
          status: "success",
          data: {
            accepted: true,
            note: "W7S Metal does not send Telegram notifications in the MVP service."
          }
        });
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        if (await serveStaticRoute({ request, response, url, config, store })) return;
      }

      text(response, 404, "Not found.\n");
    } catch (error) {
      json(response, 500, {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { config, store, server };
};

export const listen = async (config = loadConfig()) => {
  const metal = await createMetalServer(config);
  await new Promise<void>((resolve) => {
    metal.server.listen(config.port, config.host, resolve);
  });
  return metal;
};
