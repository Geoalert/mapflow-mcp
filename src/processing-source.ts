import type { CalculateCostRequest, Source } from "./inputs.js";
export function resolveSource(
	req: Pick<CalculateCostRequest, "source" | "dataProvider">,
): Source | undefined {
	return (
		req.source ??
		(req.dataProvider ? { type: "provider", ...req.dataProvider } : undefined)
	);
}
function buildSourceParams(source: Source) {
	switch (source.type) {
		case "provider":
			return { dataProvider: { providerName: source.name, zoom: source.zoom } };
		case "catalog":
			return {
				imagerySearch: {
					dataProvider: source.dataProvider,
					imageIds: source.imageIds,
					zoom: source.zoom,
				},
			};
		case "myImagery":
			return {
				myImagery:
					"imageId" in source
						? { imageIds: [source.imageId] }
						: { mosaicId: source.mosaicId },
			};
		case "userDefined":
			return {
				userDefined: {
					sourceType: "XYZ",
					url: source.url,
					zoom: source.zoom,
					crs: source.crs,
				},
			};
	}
}
export function buildParams(
	source: Source | undefined,
	inferenceParams?: Record<string, string>,
) {
	if (!source) return undefined;
	const sourceParams = buildSourceParams(source);
	return { sourceParams, ...(inferenceParams ? { inferenceParams } : {}) };
}
