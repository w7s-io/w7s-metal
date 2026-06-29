import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { contentTypeFor, text } from "./http.js";
import { hostForDeployment, sanitizePart } from "./names.js";
import { listDeploymentRecords, readDeploymentRecord, staticFilePath, type DeploymentRecord, type Store } from "./storage.js";
import type { MetalConfig } from "./config.js";
import { ensureWorkerdRuntime } from "./workerd.js";

const stripPort = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

const parseW7sHost = (config: MetalConfig, host: string) => {
  const cleanHost = stripPort(host);
  const base = stripPort(config.baseDomain);
  if (base === "localhost" || cleanHost === "localhost" || cleanHost === "127.0.0.1") return null;
  if (!cleanHost.endsWith(`.${base}`)) return null;

  const prefix = cleanHost.slice(0, -1 * (`.${base}`).length);
  const branchMatch = prefix.match(/^(.+)--([a-z0-9-]+)$/);
  if (branchMatch) {
    return {
      ownerSlug: branchMatch[2] ?? "",
      environment: sanitizePart(branchMatch[1] ?? "")
    };
  }
  return {
    ownerSlug: sanitizePart(prefix),
    environment: "production"
  };
};

const findLocalhostRecord = async (store: Store, pathname: string) => {
  const [, owner, repo, maybeEnv] = pathname.split("/");
  if (!owner || !repo) return null;
  const environment = maybeEnv ? sanitizePart(maybeEnv) : "production";
  const record = await readDeploymentRecord(store, sanitizePart(owner), sanitizePart(repo), environment);
  if (!record) return null;
  const prefix = `/${owner}/${repo}${maybeEnv ? `/${maybeEnv}` : ""}`;
  return { record, assetPath: pathname.slice(prefix.length) || "/" };
};

const findHostedRecord = async (store: Store, config: MetalConfig, request: IncomingMessage, pathname: string) => {
  const parsedHost = parseW7sHost(config, request.headers.host || "");
  if (!parsedHost) return null;

  const firstSegment = pathname.split("/").filter(Boolean)[0];
  if (!firstSegment) {
    const sameName = await readDeploymentRecord(store, parsedHost.ownerSlug, parsedHost.ownerSlug, parsedHost.environment);
    return sameName ? { record: sameName, assetPath: "/" } : null;
  }

  const record = await readDeploymentRecord(store, parsedHost.ownerSlug, sanitizePart(firstSegment), parsedHost.environment);
  if (!record) return null;
  const assetPath = pathname.slice(`/${firstSegment}`.length) || "/";
  return { record, assetPath };
};

const resolveStaticAsset = async (store: Store, record: DeploymentRecord, assetPath: string) => {
  const normalized = path.posix.normalize(`/${assetPath}`).replace(/^\/+/, "");
  const candidates = [
    normalized || "index.html",
    normalized.endsWith("/") ? `${normalized}index.html` : `${normalized}/index.html`
  ];

  for (const candidate of candidates) {
    const filePath = staticFilePath(store, record, candidate);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) return { filePath, pathname: candidate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return null;
};

const proxyToWorkerd = async (params: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  config: MetalConfig;
  store: Store;
  record: DeploymentRecord;
  assetPath: string;
}) => {
  const origin = await ensureWorkerdRuntime({
    store: params.store,
    config: params.config,
    record: params.record
  });
  const target = new URL(params.assetPath || "/", origin);
  target.search = params.url.search;

  const headers = new Headers();
  for (const [name, value] of Object.entries(params.request.headers)) {
    if (!value || name.toLowerCase() === "host" || name.toLowerCase() === "connection") continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  headers.set("x-w7s-owner", params.record.ownerSlug);
  headers.set("x-w7s-repo", params.record.repoSlug);
  headers.set("x-w7s-repository", params.record.repository);
  headers.set("x-w7s-environment", params.record.environment);

  const method = params.request.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : params.request;
  const upstream = await fetch(target, {
    method,
    headers,
    body,
    // Node fetch requires this when streaming a Node request body.
    duplex: body ? "half" : undefined
  } as RequestInit & { duplex?: "half" });

  params.response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  if (method === "HEAD" || !upstream.body) {
    params.response.end();
    return;
  }
  const bytes = Buffer.from(await upstream.arrayBuffer());
  params.response.end(bytes);
};

export const serveStaticRoute = async (params: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  config: MetalConfig;
  store: Store;
}) => {
  const match =
    (await findHostedRecord(params.store, params.config, params.request, params.url.pathname)) ??
    (await findLocalhostRecord(params.store, params.url.pathname));

  if (!match) return false;
  if (match.record.staticRoot) {
    const asset = await resolveStaticAsset(params.store, match.record, decodeURIComponent(match.assetPath));
    if (asset) {
      const bytes = await fs.readFile(asset.filePath);
      params.response.writeHead(200, {
        "content-type": contentTypeFor(asset.pathname),
        "cache-control": asset.pathname === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
        "x-w7s-metal-repository": match.record.repository,
        "x-w7s-metal-environment": match.record.environment
      });
      params.response.end(bytes);
      return true;
    }
  }

  if (match.record.workerEntrypoint) {
    await proxyToWorkerd({
      request: params.request,
      response: params.response,
      url: params.url,
      config: params.config,
      store: params.store,
      record: match.record,
      assetPath: decodeURIComponent(match.assetPath)
    });
    return true;
  }

  if (match.record.staticRoot) {
    const fallback = await resolveStaticAsset(params.store, match.record, "/");
    if (fallback) {
      const bytes = await fs.readFile(fallback.filePath);
      params.response.writeHead(200, {
        "content-type": contentTypeFor(fallback.pathname),
        "cache-control": "no-cache",
        "x-w7s-metal-repository": match.record.repository,
        "x-w7s-metal-environment": match.record.environment
      });
      params.response.end(bytes);
      return true;
    }
  }

  text(params.response, 404, "Not found.\n");
  return true;
};

export const routeSummary = async (store: Store, config: MetalConfig) => {
  const records = await listDeploymentRecords(store);
  return records.map((record) => ({
    repository: record.repository,
    environment: record.environment,
    url: record.url,
    host: hostForDeployment({
      baseDomain: config.baseDomain,
      ownerSlug: record.ownerSlug,
      environment: record.environment
    }),
    staticFiles: record.staticFileCount,
    workerEntrypoint: record.workerEntrypoint
  }));
};
