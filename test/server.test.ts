import http from "node:http";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createMetalServer, type MetalServer } from "../src/server.js";

const servers: MetalServer[] = [];

const zip = (files: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, source]) => [name, new TextEncoder().encode(source)])
      )
    )
  );

const startServer = async (overrides: Partial<MetalServer["config"]> = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "w7s-metal-test-"));
  const metal = await createMetalServer({
    baseDomain: "metal.test",
    dataDir,
    host: "127.0.0.1",
    port: 0,
    ...overrides
  });
  await new Promise<void>((resolve) => metal.server.listen(0, "127.0.0.1", resolve));
  servers.push(metal);
  const address = metal.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to TCP");
  return {
    metal,
    origin: `http://127.0.0.1:${address.port}`
  };
};

const getWithHost = async (origin: string, pathname: string, host: string) => {
  const url = new URL(pathname, origin);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: { host }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          })
        );
      }
    );
    request.on("error", reject);
    request.end();
  });
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (metal) =>
        new Promise<void>((resolve, reject) => {
          metal.server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("w7s-metal server", () => {
  it("exposes health metadata", async () => {
    const { origin } = await startServer();
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "w7s-metal",
      baseDomain: "metal.test"
    });
  });

  it("accepts a w7s-cloud style static deploy and serves it", async () => {
    const { origin } = await startServer();
    const deploy = await fetch(`${origin}/api/v1/deploy`, {
      method: "POST",
      headers: {
        authorization: "Bearer github-token",
        "content-type": "application/zip",
        "x-github-repository": "Acme/Web",
        "x-github-branch": "main",
        "x-github-sha": "abc123"
      },
      body: zip({
        "dist/index.html": "<h1>Hello W7S Metal</h1>",
        "dist/assets/app.js": "console.log('ok');"
      })
    });

    expect(deploy.status).toBe(200);
    const payload = await deploy.json();
    expect(payload).toMatchObject({
      status: "success",
      data: {
        url: "https://acme.metal.test/web/",
        deployment: {
          repository: "Acme/Web",
          environment: "production",
          targets: {
            static: {
              root: "dist",
              fileCount: 2
            }
          }
        }
      }
    });

    const page = await getWithHost(origin, "/web/", "acme.metal.test");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Hello W7S Metal");
  });

  it("serves branch deployments from branch-prefixed hosts", async () => {
    const { origin } = await startServer();
    await fetch(`${origin}/api/v1/deploy`, {
      method: "POST",
      headers: {
        authorization: "Bearer github-token",
        "content-type": "application/zip",
        "x-github-repository": "Acme/Web",
        "x-github-branch": "Feature/API.v2_test",
        "x-github-sha": "def456"
      },
      body: zip({
        "build/index.html": "<h1>Branch</h1>"
      })
    });

    const page = await getWithHost(origin, "/web/", "feature-api-v2-test--acme.metal.test");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Branch");
  });

  it("enforces the configured deploy token", async () => {
    const { origin } = await startServer({ deployToken: "metal-secret" });
    const response = await fetch(`${origin}/api/v1/deploy`, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong",
        "content-type": "application/zip",
        "x-github-repository": "Acme/Web",
        "x-github-branch": "main",
        "x-github-sha": "abc123"
      },
      body: zip({
        "dist/index.html": "<h1>Nope</h1>"
      })
    });

    expect(response.status).toBe(401);
  });

  it("writes a workerd handoff plan for Worker deployments", async () => {
    const { origin, metal } = await startServer();
    const response = await fetch(`${origin}/api/v1/deploy`, {
      method: "POST",
      headers: {
        authorization: "Bearer github-token",
        "content-type": "application/zip",
        "x-github-repository": "Acme/API",
        "x-github-branch": "main",
        "x-github-sha": "abc123"
      },
      body: zip({
        "backend/index.ts": "export default { fetch: () => new Response('ok') };"
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.deployment.targets.worker).toMatchObject({
      entrypoint: "backend/index.ts",
      runtime: "workerd",
      status: "planned"
    });

    const plan = await fs.readFile(
      path.join(metal.config.dataDir, "workerd", "acme", "api", "production", "workerd.plan.json"),
      "utf8"
    );
    expect(plan).toContain("backend/index.ts");
  });
});
