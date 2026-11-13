import type * as z from "zod";
import {
	costDetailsSchema,
	processingSchema,
	projectSchema,
} from "./api-schemas.js";
import {
	type CalculateCostRequest,
	type CreateProcessingRequest,
	calculateCostRequestSchema,
	createProcessingRequestSchema,
	createProjectSchema,
} from "./inputs.js";
import { createModelCatalog } from "./model-catalog.js";
import {
	getProcessingResult,
	type resultRequestSchema,
} from "./processing-result.js";
import { buildParams, resolveSource } from "./processing-source.js";
import { createReadClient } from "./read-client.js";
import {
	type mapflowDataProviderSchema,
	type mapflowModelSchema,
	type mapflowUserLimitsSchema,
	mapflowUserStatusSchema,
} from "./schemas.js";
import { type ApiCredentials, ApiError, createTransport } from "./transport.js";
export type { CalculateCostRequest, CreateProcessingRequest };
export type UserStatus = z.infer<typeof mapflowUserStatusSchema>;
export type UserLimits = z.infer<typeof mapflowUserLimitsSchema>;
export type Model = z.infer<typeof mapflowModelSchema>;
export type DataProvider = z.infer<typeof mapflowDataProviderSchema>;
export type Processing = z.infer<typeof processingSchema>;
export type MapflowClient = ReturnType<typeof createMapflowClient>;
export function createMapflowClient(token: ApiCredentials) {
	const http = createTransport(token);
	const reads = createReadClient(http);
	let cache: { data: UserStatus; expiresAt: number } | null = null;
	const fetchUserStatus = () =>
		http.requestJson("/rest/user/status", mapflowUserStatusSchema);
	const getCachedUserStatus = async () => {
		if (cache && cache.expiresAt > Date.now()) return cache.data;
		const data = await fetchUserStatus();
		cache = { data, expiresAt: Date.now() + 300_000 };
		return data;
	};
	const catalog = createModelCatalog(http, getCachedUserStatus);
	async function validateConfiguration(req: CalculateCostRequest) {
		const { status, models } = await catalog.getContext();
		const matches = models.filter((m) => m.name === req.wdName);
		const model = matches[0];
		if (!model)
			throw new ApiError(`Model not found: ${req.wdName}`, "INVALID_MODEL");
		if (matches.length !== 1)
			throw new ApiError(
				`Multiple models have name: ${req.wdName}`,
				"AMBIGUOUS_MODEL",
			);
		const source = resolveSource(req);
		if (
			source?.type === "provider" &&
			!status.dataProviders?.some((p) => p.name === source.name)
		)
			throw new ApiError(
				`Imagery provider is not available: ${source.name}`,
				"INVALID_PROVIDER",
			);
		return { model, source };
	}
	return {
		...http,
		...reads,
		getProcessingResult(args: z.input<typeof resultRequestSchema>) {
			return getProcessingResult(http, args);
		},
		createProject(args: z.input<typeof createProjectSchema>) {
			return http.post(
				"/rest/projects",
				projectSchema,
				createProjectSchema.parse(args),
			);
		},
		fetchUserStatus,
		getCachedUserStatus,
		async getModels() {
			return (await catalog.getContext()).models;
		},
		async getImagerySources() {
			return (await getCachedUserStatus()).dataProviders ?? [];
		},
		async getLimits() {
			const s = await fetchUserStatus();
			return {
				processedArea: s.processedArea,
				remainingArea: s.remainingArea,
				remainingCredits: s.remainingCredits,
				areaLimit: s.areaLimit,
				memoryLimit: s.memoryLimit,
			};
		},
		async createProcessing(args: CreateProcessingRequest) {
			const req = createProcessingRequestSchema.parse(args);
			const { model, source } = await validateConfiguration(req);
			let warnings: string[] = [];
			if (source?.type === "myImagery") {
				const status = await reads.getMosaicStatus(source.mosaicId);
				if (!status.ready)
					throw new ApiError(
						"Mosaic is not ready: wait for pending, preprocessing and loading images to finish",
						"MOSAIC_NOT_READY",
					);
				warnings = status.warnings;
			}
			const projectId = await catalog.prepareProject(model, req.projectId);
			const result = await http.post("/rest/processings/v2", processingSchema, {
				name: req.name,
				wdName: req.wdName,
				geometry: req.geometry,
				projectId,
				params: buildParams(source, req.inferenceParams),
				blocks: req.blocks,
				meta: req.meta,
			});
			cache = null;
			return { ...result, warnings };
		},
		getProcessing(id: string) {
			return http.requestJson(`/rest/processings/${id}/v2`, processingSchema);
		},
		async calculateCost(args: CalculateCostRequest) {
			const req = calculateCostRequestSchema.parse(args);
			const { model, source } = await validateConfiguration(req);
			const details = await http.post(
				"/rest/processing/cost/details/v2",
				costDetailsSchema,
				{
					wdId: model.id,
					geometry: req.geometry,
					areaSqKm: req.areaSqKm,
					params: buildParams(source, req.inferenceParams),
					blocks: req.blocks,
				},
			);
			return {
				...details,
				cost: details.dataCost + details.processingCost,
				unit: "credits" as const,
				preliminary: !req.geometry || !source,
			};
		},
	};
}
