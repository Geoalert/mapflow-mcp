import { searchProviders } from "./inputs.js";

// Backend aggregates provider errors even when a provider was not selected.
export function relevantCatalogErrors(errors: unknown, selected?: string[]) {
	if (!Array.isArray(errors)) return errors ?? null;
	const providers = selected ?? [...searchProviders];
	return errors.filter((error) => {
		if (
			!error ||
			typeof error !== "object" ||
			error.message !==
				"Invalid request: productTypes or dataProviders are incorrect" ||
			typeof error.providerName !== "string"
		)
			return true;
		const family = error.providerName.toLowerCase();
		if (!["skywatch", "roscosmos", "orbview", "cgmosaic"].includes(family))
			return true;
		return providers.some((provider) => {
			const name = provider.toLowerCase();
			return family === "cgmosaic"
				? name.startsWith("cg_mosaic_") || name === "arcgis_world_imagery"
				: name === family || name.startsWith(`${family}_`);
		});
	});
}
