import { describe, expect, test } from "bun:test";
import { createS3Storage, InvalidKeyError } from "../src";
import { storageContract } from "./contract";
import { fakeS3 } from "./fake-s3";

const config = {
  bucket: "bucket",
  accessKeyId: "test-key-id",
  secretAccessKey: "test-secret",
  publicBaseUrl: "https://bucket.example",
};

storageContract("s3", () => createS3Storage(config, { client: fakeS3() }));

describe("s3", () => {
  test("put passes the key and content type to the client", async () => {
    const bucket = fakeS3();
    const storage = createS3Storage(config, { client: bucket });
    await storage.put("reports/r.pdf", "%PDF", "application/pdf");
    await storage.put("media/a.webp", new Uint8Array([1]));
    expect(bucket.calls).toEqual(["write reports/r.pdf", "write media/a.webp"]);
    expect(bucket.objects.get("reports/r.pdf")?.type).toBe("application/pdf");
    expect(bucket.objects.get("media/a.webp")?.type).toBe("image/webp");
  });

  test("a refused key never reaches the bucket", async () => {
    const bucket = fakeS3();
    const storage = createS3Storage(config, { client: bucket });
    await expect(storage.put("../x", "x")).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    await expect(storage.get("a//b")).rejects.toBeInstanceOf(InvalidKeyError);
    expect(bucket.calls).toEqual([]);
  });

  test("an error other than a missing key is thrown, not read as null", async () => {
    const bucket = fakeS3();
    const storage = createS3Storage(config, { client: bucket });
    bucket.failWith = Object.assign(new Error("Access Denied"), {
      code: "AccessDenied",
    });
    await expect(storage.get("a.png")).rejects.toThrow("Access Denied");
    await expect(storage.put("a.png", "x")).rejects.toThrow("Access Denied");
    await expect(storage.delete("a.png")).rejects.toThrow("Access Denied");
  });

  test("publicUrl uses the public base, not the endpoint", () => {
    const storage = createS3Storage(
      { ...config, endpoint: "https://s3.provider.example" },
      { client: fakeS3() },
    );
    expect(storage.publicUrl("media/a.png")).toBe(
      "https://bucket.example/media/a.png",
    );
  });

  test("a private bucket has no public URL", () => {
    const { publicBaseUrl: _, ...privateConfig } = config;
    expect(
      createS3Storage(privateConfig, { client: fakeS3() }).publicUrl("a.png"),
    ).toBeNull();
  });

  test("builds a real Bun.S3Client when no client is given", async () => {
    // Bun's client against a loopback stand-in: proves the config reaches the
    // wire (bucket in the path, the content type, a signed request) without a
    // real bucket or any network beyond 127.0.0.1.
    const seen: {
      method: string;
      path: string;
      type: string | null;
      auth: boolean;
    }[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        seen.push({
          method: req.method,
          path: url.pathname,
          type: req.headers.get("content-type"),
          auth: (req.headers.get("authorization") ?? "").startsWith(
            "AWS4-HMAC-SHA256",
          ),
        });
        if (req.method === "PUT") return new Response(null, { status: 200 });
        return new Response(null, { status: 404 });
      },
    });
    try {
      const storage = createS3Storage({
        ...config,
        region: "us-east-1",
        endpoint: `http://127.0.0.1:${server.port}`,
      });
      await storage.put("media/a.png", new Uint8Array([1, 2]), "image/png");
      expect(await storage.get("media/missing.png")).toBeNull();
      expect(seen).toEqual([
        {
          method: "PUT",
          path: "/bucket/media/a.png",
          type: "image/png",
          auth: true,
        },
        {
          method: "HEAD",
          path: "/bucket/media/missing.png",
          type: null,
          auth: true,
        },
      ]);
    } finally {
      server.stop(true);
    }
  });
});
