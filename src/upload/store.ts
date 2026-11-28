import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { ApiCredentials } from "../transport.js";
import { ApiError } from "../transport.js";
import { imagery } from "./imagery.js";

export const MAX_FILE_BYTES = 2 * 1024 ** 3;
const HOUR = 3600000;
type State = "waiting" | "receiving" | "processing" | "ready" | "failed";
type Actor = { owner: string; credentials: ApiCredentials };
export type UploadArgs = {
	file?: { download_url: string; file_name?: string };
	fileName?: string;
	fileSize?: number;
	sha1?: string;
	name?: string;
	mosaicId?: string;
};

export class UploadError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function attachmentUrl(raw: string) {
	const url = new URL(raw);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		!(
			url.hostname.endsWith(".oaiusercontent.com") ||
			url.hostname === "files.openai.com"
		)
	)
		throw new UploadError(
			400,
			"Unsupported attachment host. Call upload-image without file and use the upload link.",
		);
	return url;
}

export class Upload {
	readonly token = `mf-${crypto.randomUUID()}`;
	readonly created = Date.now();
	readonly source: "attachment" | "link";
	state: State = "waiting";
	filename: string | undefined;
	name: string;
	mosaicId?: string;
	imageId?: string;
	size?: number;
	checksum?: string;
	existing = false;
	maxBytes = MAX_FILE_BYTES;
	freeBytes?: number;
	error?: string;
	constructor(
		readonly owner: string,
		private credentials: ApiCredentials | undefined,
		readonly args: Omit<UploadArgs, "file">,
		attachment: boolean,
	) {
		this.source = attachment ? "attachment" : "link";
		this.filename = args.fileName;
		this.name =
			args.name ?? args.fileName?.replace(/\.tiff?$/i, "") ?? "GeoTIFF";
		this.mosaicId = args.mosaicId;
	}
	renew(actor: Actor) {
		if (actor.owner !== this.owner)
			throw new UploadError(404, "Unknown upload.");
		if (this.state !== "ready" && this.state !== "failed")
			this.credentials = actor.credentials;
	}
	private client() {
		if (!this.credentials)
			throw new UploadError(401, "Refresh this upload in the chat.");
		return imagery(this.credentials);
	}
	async prepare() {
		const client = this.client();
		if (this.mosaicId) this.name = (await client.mosaic(this.mosaicId)).name;
		const limits = await client.limits();
		this.maxBytes = Math.min(
			MAX_FILE_BYTES,
			limits.maxUploadFileSize || MAX_FILE_BYTES,
		);
		this.freeBytes = limits.memoryFree ?? undefined;
		if (this.args.fileSize) this.checkSize(this.args.fileSize);
	}
	private checkSize(bytes: number) {
		if (
			bytes > this.maxBytes ||
			(this.freeBytes !== undefined && bytes > this.freeBytes)
		)
			throw new UploadError(
				413,
				"File exceeds your My Imagery file size or remaining storage limit.",
			);
	}
	async reuse(hash: string) {
		const match = await this.client().existing(hash, this.args.mosaicId);
		if (!match) return false;
		this.mosaicId = match.mosaic.id;
		this.name = match.mosaic.name;
		this.imageId = match.image.id;
		this.existing = true;
		this.state = match.image.state === "READY" ? "ready" : "processing";
		if (this.state === "ready") this.credentials = undefined;
		return true;
	}
	begin() {
		if (Date.now() - this.created >= HOUR)
			throw new UploadError(410, "Upload link expired.");
		if (this.state !== "waiting")
			throw new UploadError(409, "Upload link has already been used.");
		this.error = undefined;
		this.state = "receiving";
	}
	fail(error: unknown) {
		this.state = "failed";
		this.error =
			error instanceof UploadError || error instanceof ApiError
				? error.message
				: "Upload interrupted. Check My Imagery before trying again.";
		this.credentials = undefined;
	}
	async receive(
		body: ReadableStream<Uint8Array> | null,
		filename: string,
		size: number | undefined,
	) {
		if (
			!body ||
			(size !== undefined &&
				(!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES))
		)
			throw new UploadError(413, "Invalid or oversized GeoTIFF.");
		if (
			Array.from(filename).some((char) => char.charCodeAt(0) < 32) ||
			!/^[^/\\]{1,250}\.tiff?$/i.test(filename)
		)
			throw new UploadError(400, "Choose a GeoTIFF (.tif or .tiff).");
		if (size !== undefined) this.checkSize(size);
		const max = Math.min(this.maxBytes, this.freeBytes ?? MAX_FILE_BYTES);
		const dir = await mkdtemp(join(tmpdir(), "mapflow-upload-"));
		try {
			const path = join(dir, "image.tif");
			const hash = createHash("sha1");
			let count = 0;
			const reader = body.getReader();
			async function* checked() {
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						count += value.length;
						if (count > max)
							throw new UploadError(413, "GeoTIFF exceeds upload limit.");
						hash.update(value);
						yield value;
					}
				} catch (error) {
					await reader.cancel().catch(() => {});
					throw error;
				}
			}
			await pipeline(checked(), createWriteStream(path, { mode: 0o600 }), {
				signal: AbortSignal.timeout(15 * 60000),
			});
			const signature = Buffer.from(
				await Bun.file(path).slice(0, 4).arrayBuffer(),
			).toString("hex");
			if (!["49492a00", "4d4d002a", "49492b00", "4d4d002b"].includes(signature))
				throw new UploadError(400, "File does not have a TIFF header.");
			if (size !== undefined && size !== count)
				throw new UploadError(400, "Incomplete file.");
			this.size = count;
			this.filename = filename;
			this.checksum = hash.digest("hex");
			if (this.args.sha1 && this.args.sha1.toLowerCase() !== this.checksum)
				throw new UploadError(400, "File checksum does not match.");
			if (
				this.source === "attachment" &&
				!this.args.sha1 &&
				(await this.reuse(this.checksum))
			)
				return;
			if (!this.args.name && !this.mosaicId)
				this.name = filename.replace(/\.tiff?$/i, "").slice(0, 120);
			const result = await this.client().send(
				path,
				filename,
				this.name,
				this.mosaicId,
			);
			this.mosaicId = result.mosaic_id;
			this.imageId = result.image_id ?? result.id;
			this.state = "processing";
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
	async poll() {
		if (this.state !== "processing") return;
		if (!this.imageId && this.mosaicId && this.checksum) {
			const images = await this.client().imagesIn(this.mosaicId);
			this.imageId = images.find(
				(image) => image.checksum?.toLowerCase() === this.checksum,
			)?.id;
		}
		if (!this.imageId) return;
		const image = await this.client().image(this.imageId);
		if (image.state === "READY") {
			this.state = "ready";
			this.credentials = undefined;
		} else if (image.state === "FAILED")
			this.fail(
				new UploadError(422, "My Imagery could not process the GeoTIFF."),
			);
	}
	result(origin: string) {
		const url = `${origin}/agent/upload/${this.token}`;
		return {
			upload: this.token,
			source: this.source,
			state: this.state,
			mosaic: { id: this.mosaicId, name: this.name },
			image_id: this.imageId,
			existing: this.existing,
			error: this.error,
			file: { name: this.filename, size: this.size ?? this.args.fileSize },
			limits: {
				max_file_bytes: this.maxBytes,
				max_file: `${this.maxBytes} bytes`,
			},
			...(this.state === "waiting"
				? {
						upload_url: url,
						send: `curl --upload-file FILE.tif '${url}?name=image.tif'`,
						next: "Choose the GeoTIFF on the card or open upload_url. Then call image-status with upload.",
					}
				: {}),
		};
	}
}

export class UploadStore {
	private entries = new Map<string, Upload>();
	private inFlight = 0;
	get(token: string) {
		const upload = this.entries.get(token);
		if (!upload) throw new UploadError(404, "Unknown or expired upload.");
		return upload;
	}
	async receive(
		upload: Upload,
		file: () => Promise<{
			body: ReadableStream<Uint8Array> | null;
			name: string;
			size?: number;
		}>,
	) {
		if (this.inFlight >= 4)
			throw new UploadError(
				429,
				"Other uploads are in progress. Try again shortly.",
			);
		upload.begin();
		this.inFlight++;
		try {
			const { body, name, size } = await file();
			await upload.receive(body, name, size);
		} catch (error) {
			if (
				upload.source === "link" &&
				error instanceof UploadError &&
				[400, 413].includes(error.status)
			) {
				upload.state = "waiting";
				upload.error = error.message;
			} else upload.fail(error);
			throw error;
		} finally {
			this.inFlight--;
		}
	}
	async create(actor: Actor, { file, ...args }: UploadArgs) {
		if (this.entries.size >= 2000)
			throw new UploadError(429, "Upload session limit reached.");
		if (args.fileSize && args.fileSize > MAX_FILE_BYTES)
			throw new UploadError(413, "GeoTIFF exceeds upload limit.");
		const url = file && attachmentUrl(file.download_url);
		const upload = new Upload(
			actor.owner,
			actor.credentials,
			{ ...args, fileName: args.fileName ?? file?.file_name },
			!!file,
		);
		if (!args.sha1 || !(await upload.reuse(args.sha1))) await upload.prepare();
		this.entries.set(upload.token, upload);
		setTimeout(() => this.entries.delete(upload.token), HOUR).unref();
		if (url && upload.state === "waiting") {
			if (this.inFlight >= 4) {
				this.entries.delete(upload.token);
				throw new UploadError(429, "Other uploads are in progress.");
			}
			void this.receive(upload, async () => {
				const response = await fetch(url, {
					redirect: "error",
					signal: AbortSignal.timeout(15 * 60000),
				});
				if (!response.ok)
					throw new UploadError(
						400,
						"Attachment unavailable. Choose the GeoTIFF on a fresh upload card.",
					);
				return {
					body: response.body,
					name: upload.filename ?? "image.tif",
					size: response.headers.has("content-length")
						? Number(response.headers.get("content-length"))
						: undefined,
				};
			}).catch(() => {});
		}
		return upload;
	}
}
