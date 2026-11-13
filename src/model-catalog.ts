import * as z from "zod";
import { projectSchema } from "./api-schemas.js";
import { mapflowModelSchema, type mapflowUserStatusSchema } from "./schemas.js";
import { ApiError, type ApiTransport } from "./transport.js";

const modelSchema = mapflowModelSchema.extend({
	id: z.uuid(),
	name: z.string().min(1),
});
const labCatalogSchema = z.array(
	z.object({
		workflowDef: modelSchema.extend({ kind: z.literal("lab") }),
		activeOnAccount: z.boolean(),
		activeProjectIds: z.array(z.uuid()),
	}),
);
const projectModelsSchema = projectSchema.extend({
	workflowDefs: z.array(z.object({ id: z.uuid() })),
	displayProperties: z
		.object({
			models: z.union([z.array(z.string()), z.literal("all")]).nullish(),
		})
		.catchall(z.unknown())
		.nullish(),
});
type Model = z.output<typeof modelSchema>;
type UserStatus = z.output<typeof mapflowUserStatusSchema>;

// HTTP creates a client per request. Serialize project filter writes across
// clients in this process, without sharing credentials or project payloads.
const preparations = new Map<string, Promise<string>>();

export function createModelCatalog(
	http: ApiTransport,
	getUserStatus: () => Promise<UserStatus>,
) {
	async function getContext() {
		const [status, lab] = await Promise.all([
			getUserStatus(),
			http.requestJson("/rest/models/lab", labCatalogSchema),
		]);
		const models = new Map<string, Model>();
		for (const model of z.array(modelSchema).parse(status.models ?? [])) {
			// Archived Lab models disappear from the fresh catalog even while the
			// account status remains cached.
			if (model.kind !== "lab") models.set(model.id, model);
		}
		// The fresh catalog wins over a cached account copy of a preferred Lab model.
		for (const { workflowDef } of lab) models.set(workflowDef.id, workflowDef);
		return { status, models: [...models.values()] };
	}
	async function prepareProject(model: Model, projectId?: string) {
		if (model.kind !== "lab") return projectId;
		const targetId =
			projectId ??
			(await http.requestJson("/rest/projects/default", projectModelsSchema))
				.id;
		const previous = preparations.get(targetId);
		const pending = (async () => {
			// A failed preparation must not poison subsequent attempts.
			await previous?.catch(() => undefined);
			const path = `/rest/projects/${targetId}`;
			const project = await http.requestJson(path, projectModelsSchema);
			if (project.id !== targetId)
				throw new ApiError(
					"Project response ID does not match",
					"INVALID_RESPONSE",
				);
			if (!project.workflowDefs.some((item) => item.id === model.id))
				await http.requestJson(`${path}/models/${model.id}`, z.literal("OK"), {
					method: "POST",
				});
			const properties = project.displayProperties;
			if (
				Array.isArray(properties?.models) &&
				!properties.models.includes(model.id)
			) {
				// The web filters workflowDefs through this explicit selection. Send only
				// displayProperties, preserving unrelated settings and project metadata.
				const updated = await http.requestJson(path, projectModelsSchema, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						displayProperties: {
							...properties,
							models: [...properties.models, model.id],
						},
					}),
				});
				if (
					updated.id !== targetId ||
					!Array.isArray(updated.displayProperties?.models) ||
					!updated.displayProperties.models.includes(model.id)
				)
					throw new ApiError(
						"Project model selection was not updated",
						"INVALID_RESPONSE",
					);
			}
			return targetId;
		})();
		preparations.set(targetId, pending);
		try {
			return await pending;
		} catch (error) {
			if (error instanceof ApiError)
				throw new ApiError(
					`Could not prepare the Lab model in the project. Processing was not started. ${error.message}`,
					error.code,
				);
			throw error;
		} finally {
			if (preparations.get(targetId) === pending) preparations.delete(targetId);
		}
	}
	return { getContext, prepareProject };
}
