import * as z from "zod";
import { projectSchema } from "./api-schemas.js";
import { deleteProjectSchema, updateProjectSchema } from "./inputs.js";
import { ApiError, type ApiTransport } from "./transport.js";

export function createProjectClient(http: ApiTransport) {
	return {
		async updateProject(args: z.input<typeof updateProjectSchema>) {
			const { projectId, ...fields } = updateProjectSchema.parse(args);
			const result = await http.requestJson(
				`/rest/projects/${projectId}`,
				projectSchema,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(fields),
				},
			);
			if (
				result.id !== projectId ||
				(fields.name !== undefined && result.name !== fields.name) ||
				(fields.description !== undefined &&
					result.description !== fields.description)
			)
				throw new ApiError(
					"Project update outcome is unknown. Check get-project before retrying.",
					"INVALID_RESPONSE",
				);
			return result;
		},
		async deleteProject(args: z.input<typeof deleteProjectSchema>) {
			const { projectId } = deleteProjectSchema.parse(args);
			const path = `/rest/projects/${projectId}`;
			const project = await http.requestJson(
				path,
				projectSchema.extend({ isDefault: z.boolean() }),
			);
			if (project.id !== projectId)
				throw new ApiError(
					"Project response ID does not match",
					"INVALID_RESPONSE",
				);
			if (project.isDefault)
				throw new ApiError(
					"Default project cannot be deleted",
					"DEFAULT_PROJECT",
				);
			await http.requestJson(path, z.literal("OK"), { method: "DELETE" });
			return { projectId, name: project.name, archived: true as const };
		},
	};
}
