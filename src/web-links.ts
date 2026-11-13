import { ApiError } from "./transport.js";

export function createWebLinks(value = Bun.env.MAPFLOW_WEB_URL) {
	let base: URL;
	try {
		base = new URL(value ?? "");
		if (
			!["https:", "http:"].includes(base.protocol) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash ||
			base.pathname !== "/"
		)
			throw new Error();
	} catch {
		throw new ApiError(
			"MAPFLOW_WEB_URL must be an HTTP(S) origin without credentials, path, query or fragment",
			"INVALID_CONFIG",
		);
	}
	const project = (id: string) =>
		new URL(`/projects/${encodeURIComponent(id)}`, base).href;
	const processing = (id: string, projectId?: string) => {
		if (!projectId) return null;
		const url = new URL(project(projectId));
		url.searchParams.set("processing", id);
		return url.href;
	};
	return { project, processing };
}
