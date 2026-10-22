import type { CalculateCostRequest, Source } from "./inputs.js";
export function resolveSource(
	req: Pick<CalculateCostRequest, "source" | "dataProvider">,
): Source | undefined {
	return (
		req.source ??
		(req.dataProvider ? { type: "provider", ...req.dataProvider } : undefined)
	);
}
export function buildParams(
	source: Source | undefined,
	inferenceParams?: Record<string, string>,
	forCost = false,
) {
	if (!source) return undefined;
	const sourceParams =
		source.type === "provider"
			? { dataProvider: { providerName: source.name, zoom: source.zoom } }
			: source.type === "catalog"
				? {
						imagerySearch: {
							dataProvider: source.dataProvider,
							imageIds: source.imageIds,
							zoom: source.zoom,
						},
					}
				: { myImagery: forCost ? {} : { mosaicId: source.mosaicId } };
	return { sourceParams, ...(inferenceParams ? { inferenceParams } : {}) };
}
