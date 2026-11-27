import { ApiError } from "../transport.js";
import { MAX_FILE_BYTES, UploadError, UploadStore } from "./store.js";

export function uploadService(publicOrigin: () => string) {
	const store = new UploadStore();
	async function handle(request: Request) {
		const url = new URL(request.url);
		const match = /^\/agent\/upload\/(mf-[a-f0-9-]{36})(\/status)?$/.exec(
			url.pathname,
		);
		const headers = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"X-Content-Type-Options": "nosniff",
		};
		try {
			if (!match?.[1]) throw new UploadError(404, "Unknown upload.");
			if (request.method === "OPTIONS")
				return new Response(null, { status: 204, headers });
			const upload = store.get(match[1]);
			if (request.method === "GET" && match[2]) {
				await upload.poll();
				return Response.json(upload.result(publicOrigin()), { headers });
			}
			if (request.method === "GET" && !match[2])
				return new Response(Bun.file(new URL("./page.html", import.meta.url)), {
					headers: {
						...headers,
						"Content-Type": "text/html; charset=utf-8",
						"Content-Security-Policy":
							"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
					},
				});
			if (request.method !== "PUT" || match[2])
				throw new UploadError(405, "Method not allowed.");
			if (upload.source !== "link")
				throw new UploadError(409, "This upload uses a chat attachment.");
			await store.receive(upload, async () => ({
				body: request.body,
				name: url.searchParams.get("name") ?? upload.filename ?? "image.tif",
				size: request.headers.has("content-length")
					? Number(request.headers.get("content-length"))
					: undefined,
			}));
			return Response.json(upload.result(publicOrigin()), {
				status: 201,
				headers,
			});
		} catch (error) {
			return Response.json(
				{
					detail:
						error instanceof UploadError || error instanceof ApiError
							? error.message
							: "Upload failed. Check My Imagery.",
				},
				{
					status:
						error instanceof UploadError
							? error.status
							: error instanceof ApiError && /^HTTP_4[0-9]{2}$/.test(error.code)
								? Number(error.code.slice(5))
								: 502,
					headers,
				},
			);
		}
	}
	return { store, handle, publicOrigin };
}
export type UploadService = ReturnType<typeof uploadService>;

// A local stdio host can open the same file picker and send local files.
let local: UploadService | undefined;
export function localUploads() {
	if (!local) {
		let listener: ReturnType<typeof Bun.serve> | undefined;
		local = uploadService(() => {
			if (!listener) {
				const service = local;
				if (!service) throw new Error("Upload service unavailable");
				listener = Bun.serve({
					hostname: "127.0.0.1",
					port: 0,
					maxRequestBodySize: MAX_FILE_BYTES,
					idleTimeout: 255,
					fetch: service.handle,
				});
				listener.unref();
			}
			return listener.url.origin;
		});
	}
	return local;
}
