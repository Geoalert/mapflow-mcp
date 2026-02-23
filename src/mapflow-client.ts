import type * as z from "zod";
import {
	type CalculateCostRequest,
	type CreateProcessingRequest,
	type mapflowDataProviderSchema,
	type mapflowModelSchema,
	mapflowProcessingSchema,
	type mapflowUserLimitsSchema,
	mapflowUserStatusSchema,
} from "./schemas.js";

export type { CreateProcessingRequest, CalculateCostRequest };

export type Processing = z.infer<typeof mapflowProcessingSchema>;

function getMapflowBaseUrl(): string {
	return (
		Bun.env?.MAPFLOW_BASE_URL ??
		process.env.MAPFLOW_BASE_URL ??
		"https://whitemaps-staging.mapflow.ai"
	);
}
const userStatusCacheTtlMs = 300_000;

export type UserStatus = z.infer<typeof mapflowUserStatusSchema>;
export type UserLimits = z.infer<typeof mapflowUserLimitsSchema>;
export type Model = z.infer<typeof mapflowModelSchema>;
export type DataProvider = z.infer<typeof mapflowDataProviderSchema>;

export type MapflowClient = {
	request: (path: string, init?: RequestInit) => Promise<Response>;
	requestJson: <T>(
		path: string,
		schema: z.ZodType<T>,
		init?: RequestInit,
	) => Promise<T>;
	fetchUserStatus: () => Promise<UserStatus>;
	getCachedUserStatus: () => Promise<UserStatus>;
	getModels: () => Promise<Model[]>;
	getLimits: () => Promise<UserLimits>;
	getImagerySources: () => Promise<DataProvider[]>;
	// V2 API methods
	createProcessing: (request: CreateProcessingRequest) => Promise<Processing>;
	getProcessing: (id: string) => Promise<Processing>;
	calculateCost: (request: CalculateCostRequest) => Promise<number>;
};

export function createMapflowClient(token: string): MapflowClient {
	let userStatusCache: { data: UserStatus; expiresAt: number } | null = null;

	const withAuthHeaders = (init?: RequestInit) => {
		return {
			Authorization: `Basic ${token}`,
			Accept: "application/json",
			...init?.headers,
		};
	};

	const request = async (path: string, init?: RequestInit) => {
		const url = new URL(path, getMapflowBaseUrl());
		const headers = withAuthHeaders(init);

		const response = await fetch(url, {
			...init,
			headers,
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`Mapflow API request failed: ${response.status} ${response.statusText}${
					body ? ` - ${body}` : ""
				}`,
			);
		}

		return response;
	};

	const requestJson = async <T>(
		path: string,
		schema: z.ZodType<T>,
		init?: RequestInit,
	) => {
		const response = await request(path, init);
		const rawBody = await response.text();
		return schema.parse(rawBody ? JSON.parse(rawBody) : null);
	};

	const fetchUserStatus = async (): Promise<UserStatus> => {
		return requestJson("/rest/user/status", mapflowUserStatusSchema);
	};

	const getCachedUserStatus = async (): Promise<UserStatus> => {
		const now = Date.now();
		if (userStatusCache && userStatusCache.expiresAt > now) {
			return userStatusCache.data;
		}

		const fresh = await fetchUserStatus();
		userStatusCache = {
			data: fresh,
			expiresAt: now + userStatusCacheTtlMs,
		};
		return fresh;
	};

	const getModels = async (): Promise<Model[]> => {
		const status = await getCachedUserStatus();
		return status.models ?? [];
	};

	const getLimits = async (): Promise<UserLimits> => {
		const status = await fetchUserStatus();
		return {
			processedArea: status.processedArea,
			remainingArea: status.remainingArea,
			remainingCredits: status.remainingCredits,
			areaLimit: status.areaLimit,
			memoryLimit: status.memoryLimit,
		};
	};

	const getImagerySources = async (): Promise<DataProvider[]> => {
		const status = await getCachedUserStatus();
		return status.dataProviders ?? [];
	};

	// V2 API methods
	const createProcessing = async (
		req: CreateProcessingRequest,
	): Promise<Processing> => {
		const sourceParams = {
			dataProvider: {
				providerName: req.dataProvider.name,
				zoom: req.dataProvider.zoom,
			},
		};

		const body = {
			name: req.name,
			wdName: req.wdName,
			geometry: req.geometry,
			params: {
				sourceParams,
				...(req.inferenceParams && {
					inferenceParams: req.inferenceParams,
				}),
			},
			blocks: req.blocks,
			meta: req.meta,
		};

		return requestJson("/rest/processings/v2", mapflowProcessingSchema, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	};

	const getProcessing = async (id: string): Promise<Processing> => {
		return requestJson(`/rest/processings/${id}/v2`, mapflowProcessingSchema);
	};

	const calculateCost = async (req: CalculateCostRequest): Promise<number> => {
		// Get model ID by name
		const status = await getCachedUserStatus();
		const model = (status.models ?? []).find((m) => m.name === req.wdName);
		if (!model?.id) {
			throw new Error(`Model not found: ${req.wdName}`);
		}

		const sourceParams = req.dataProvider
			? {
					dataProvider: {
						providerName: req.dataProvider.name,
						zoom: req.dataProvider.zoom,
					},
				}
			: undefined;

		const body = {
			wdId: model.id,
			geometry: req.geometry,
			areaSqKm: req.areaSqKm,
			...(sourceParams && { params: { sourceParams } }),
			blocks: req.blocks,
		};

		const response = await request("/rest/processing/cost/v2", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		const text = await response.text();
		return Number.parseFloat(text);
	};

	return {
		request,
		requestJson,
		fetchUserStatus,
		getCachedUserStatus,
		getModels,
		getLimits,
		getImagerySources,
		createProcessing,
		getProcessing,
		calculateCost,
	};
}
