import { Readable } from "node:stream";
import * as z from "zod";
import { type ApiCredentials, createTransport } from "../transport.js";

const imageSchema = z.object({
	id: z.uuid(),
	mosaic_id: z.uuid().optional(),
	state: z.string().transform((state) => state.toUpperCase()),
	checksum: z.string().nullish(),
});
const mosaicSchema = z.object({ id: z.uuid(), name: z.string() });

export function imagery(credentials: ApiCredentials) {
	const http = createTransport(credentials);
	const imagesIn = (id: string) =>
		http.requestJson(`/rest/rasters/mosaic/${id}/image`, z.array(imageSchema));
	return {
		imagesIn,
		mosaic: (id: string) =>
			http.requestJson(`/rest/rasters/mosaic/${id}`, mosaicSchema),
		limits: () =>
			http.requestJson(
				"/rest/rasters/memory",
				z.object({
					maxUploadFileSize: z.number().nullish(),
					memoryFree: z.number().nullish(),
				}),
			),
		async existing(hash: string, mosaicId?: string) {
			const mosaics = mosaicId
				? [
						await http.requestJson(
							`/rest/rasters/mosaic/${mosaicId}`,
							mosaicSchema,
						),
					]
				: await http.requestJson("/rest/rasters/mosaic", z.array(mosaicSchema));
			for (const mosaic of mosaics) {
				const images = await imagesIn(mosaic.id);
				const image = images.find(
					(i) =>
						i.checksum?.toLowerCase() === hash.toLowerCase() &&
						i.state !== "FAILED",
				);
				if (image) return { image, mosaic };
			}
		},
		image(id: string) {
			return http.requestJson(`/rest/rasters/image/${id}`, imageSchema);
		},
		async send(
			path: string,
			filename: string,
			name: string,
			mosaicId?: string,
		) {
			const query = new URLSearchParams({ name, tags: "" });
			const route = mosaicId
				? `/rest/rasters/mosaic/${mosaicId}/image`
				: `/rest/rasters/mosaic/image?${query}`;
			const file = Bun.file(path);
			const boundary = crypto.randomUUID();
			const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
			const header = new TextEncoder().encode(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: image/tiff\r\n\r\n`,
			);
			const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
			const body = Readable.toWeb(
				Readable.from(
					(async function* () {
						yield header;
						yield* file.stream();
						yield tail;
					})(),
					{ objectMode: false },
				),
			) as ReadableStream<Uint8Array>;
			return http.requestJson(
				route,
				z.object({
					mosaic_id: z.uuid(),
					id: z.uuid().optional(),
					image_id: z.uuid().optional(),
				}),
				{
					method: "POST",
					body,
					signal: AbortSignal.timeout(15 * 60000),
					headers: {
						"Content-Type": `multipart/form-data; boundary=${boundary}`,
						"Content-Length": String(header.length + file.size + tail.length),
					},
				},
			);
		},
	};
}
