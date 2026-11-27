// Written once from Mapflow Interactive's last tool list (its app's door, mi-6/mi-7) by the app's
// scripts/port_platform_mcp.py on 2026-11-16 (PLAN.md, "one MCP"); kept here by hand from then on.
// Each tool's name, title, hints, description and arguments as the model sees them, and the app's
// route it calls. The app checks every argument again, and refuses one a route doesn't take.

import * as z from "zod";

export type Route = { method: "GET" | "POST" | "PUT"; path: string };
export type InteractiveTool = {
	name: string;
	title: string;
	description: string;
	annotations: {
		readOnlyHint: boolean;
		destructiveHint: boolean;
		openWorldHint: boolean;
	};
	_meta?: Record<string, unknown>;
	route: Route;
	/** Listed only with a Fewshot model (MAPFLOW_INTERACTIVE_FEWSHOT). */
	fewshot?: boolean;
	inputSchema: z.ZodRawShape;
};

/** The app's routes by their operationId (its OpenAPI, `/api/agent/v2`). */
export const ROUTES = {
	"add-image": { method: "POST", path: "/api/agent/v2/images" },
	audit: { method: "POST", path: "/api/agent/v2/sessions/{sid}/audit" },
	"audit-points": {
		method: "POST",
		path: "/api/agent/v2/sessions/{sid}/audit-points",
	},
	changes: { method: "POST", path: "/api/agent/v2/sessions/{sid}/changes" },
	"check-area": {
		method: "POST",
		path: "/api/agent/v2/mosaics/{mosaic}/area/check",
	},
	combine: { method: "POST", path: "/api/agent/v2/sessions/{sid}/combine" },
	edit: { method: "POST", path: "/api/agent/v2/sessions/{sid}/edit" },
	export: { method: "GET", path: "/api/agent/v2/sessions/{sid}/export" },
	filter: { method: "POST", path: "/api/agent/v2/sessions/{sid}/filter" },
	finish: { method: "POST", path: "/api/agent/v2/sessions/{sid}/finish" },
	"image-status": { method: "GET", path: "/api/agent/v2/images/{image}" },
	"import-layer": {
		method: "POST",
		path: "/api/agent/v2/sessions/{sid}/layers",
	},
	"list-images": { method: "GET", path: "/api/agent/v2/mosaics" },
	"list-sessions": { method: "GET", path: "/api/agent/v2/sessions" },
	publish: { method: "POST", path: "/api/agent/v2/configs/{config}/publish" },
	review: { method: "POST", path: "/api/agent/v2/sessions/{sid}/review" },
	run: { method: "POST", path: "/api/agent/v2/sessions/{sid}/runs" },
	"run-at-scale": {
		method: "POST",
		path: "/api/agent/v2/configs/{config}/run-at-scale",
	},
	"save-layer": {
		method: "POST",
		path: "/api/agent/v2/sessions/{sid}/save-layer",
	},
	select: { method: "POST", path: "/api/agent/v2/sessions/{sid}/select" },
	"select-area": { method: "GET", path: "/api/agent/v2/mosaics/{mosaic}/area" },
	"set-intent": { method: "PUT", path: "/api/agent/v2/sessions/{sid}/intent" },
	"set-query": { method: "PUT", path: "/api/agent/v2/sessions/{sid}/query" },
	sheet: { method: "POST", path: "/api/agent/v2/sessions/{sid}/sheet" },
	"start-session": { method: "POST", path: "/api/agent/v2/sessions" },
	stats: { method: "GET", path: "/api/agent/v2/sessions/{sid}/stats" },
	transform: { method: "POST", path: "/api/agent/v2/sessions/{sid}/transform" },
	"upload-image": { method: "POST", path: "/api/agent/v2/uploads" },
	"upload-refresh": {
		method: "POST",
		path: "/api/agent/v2/uploads/{upload}/refresh",
	},
	"upload-status": { method: "GET", path: "/api/agent/v2/uploads/{upload}" },
	view: { method: "POST", path: "/api/agent/v2/sessions/{sid}/view" },
	"view-mosaic": {
		method: "POST",
		path: "/api/agent/v2/mosaics/{mosaic}/view",
	},
	wait: { method: "GET", path: "/api/agent/v2/sessions/{sid}/runs/{run}" },
	wand: { method: "POST", path: "/api/agent/v2/sessions/{sid}/wand" },
} as const satisfies Record<string, Route>;

/** The tools, with a Fewshot model's arguments and its own tool where `fewshot`. */
export function interactiveTools(fewshot: boolean): InteractiveTool[] {
	const tools: InteractiveTool[] = [
		{
			name: "list-images",
			title: "Interactive: MyImagery previews",
			description:
				"Your MyImagery: your mosaics, newest first, each with its images (file name, state, size, ground pixel size).\n    The user sees them on a card in the chat (claude.ai, ChatGPT), each image's preview under its mosaic, and picks\n    the area there: a click on a mosaic or an image opens its map, as select-area does. Your sessions (images already\n    cut to an area): list-sessions.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: {
					resourceUri: "ui://mapflow-interactive/card.html",
					visibility: ["app"],
				},
				"ui/resourceUri": "ui://mapflow-interactive/card.html",
				"openai/outputTemplate": "ui://mapflow-interactive/card.html",
				"openai/widgetAccessible": true,
			},
			route: ROUTES["list-images"],
			inputSchema: {
				mosaic: z
					.string()
					.max(64)
					.optional()
					.describe("One mosaic's id: only its images, more of them"),
				mosaics: z
					.array(z.string().max(64))
					.max(50)
					.optional()
					.describe("Several mosaics' ids: these, in this order"),
			},
		},
		{
			name: "list-sessions",
			title: "Interactive: List sessions",
			description:
				"Your sessions: images made from your MyImagery mosaics, each one mosaic cut to an area (start-session and the\n    other tools take their names), newest first; the models, your saved configs, and what is left of your day. The user\n    sees them on a card in the chat (claude.ai, ChatGPT); a click on one an agent worked on opens its live page.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: "ui://mapflow-interactive/card.html" },
				"ui/resourceUri": "ui://mapflow-interactive/card.html",
				"openai/outputTemplate": "ui://mapflow-interactive/card.html",
			},
			route: ROUTES["list-sessions"],
			inputSchema: {},
		},
		{
			name: "view-mosaic",
			title: "Interactive: View a mosaic",
			description:
				"A picture of one of your mosaics (its map, its images' outlines and labelled cells; the answer gives each\n    column's longitude and each row's latitude), to choose a session's area on. With aoi: the area drawn, and what a\n    session of it would be (size, ground pixel size, the model's tiles per scale; a prompt runs at a scale within\n    max_tiles), or why it can't be made.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES["view-mosaic"],
			inputSchema: {
				mosaic: z.string().max(64).describe("A mosaic's id, from list-mosaics"),
				region: z
					.array(z.number())
					.min(4)
					.max(4)
					.optional()
					.describe(
						"The part of the mosaic to show, [west, south, east, north] in degrees; default: the whole mosaic",
					),
				aoi: z
					.union([z.array(z.number()), z.string()])
					.optional()
					.describe(
						'An area to check: cells of this view\'s picture ("B2:D4") or [west, south, east, north] in degrees',
					),
			},
		},
		{
			name: "select-area",
			title: "Interactive: Pick an area on a map",
			description:
				'Shows the user one of their mosaics on a map in the chat (claude.ai, ChatGPT), to pick a session\'s area on:\n    the whole mosaic is marked when a session of it fits, else they draw the area. The card checks it, and its\n    "Use this area" writes the mosaic and the area into the chat for add-image. Where no card shows, use\n    view-mosaic.',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: "ui://mapflow-interactive/card.html" },
				"ui/resourceUri": "ui://mapflow-interactive/card.html",
				"openai/outputTemplate": "ui://mapflow-interactive/card.html",
				"openai/widgetAccessible": true,
			},
			route: ROUTES["select-area"],
			inputSchema: {
				mosaic: z.string().max(64).describe("A mosaic's id, from list-mosaics"),
			},
		},
		{
			name: "check-area",
			title: "Interactive: Check an area",
			description:
				"For the card in the chat only: what a session of the area drawn on its map would be, or why it can't be.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
			route: ROUTES["check-area"],
			inputSchema: {
				mosaic: z.string().max(64).describe("A mosaic's id, from list-mosaics"),
				aoi: z
					.array(z.number())
					.min(4)
					.max(4)
					.describe("[west, south, east, north] in degrees"),
			},
		},
		{
			name: "add-image",
			title: "Interactive: Make a session image",
			description:
				"Makes a session image: your mosaic cut to the area, or a processing's mosaic and area (one of your sessions of\n    the day), for kinds of objects your Mapflow models don't cover (one made for the kind runs as a processing\n    instead), or to polish a processing's result. Follow with image-status until it is ready, then start-session.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES["add-image"],
			inputSchema: {
				mosaic: z
					.string()
					.max(64)
					.optional()
					.describe("A mosaic's id, from list-mosaics"),
				aoi: z
					.union([z.array(z.number()), z.string()])
					.optional()
					.describe(
						'The area of interest: cells of view-mosaic\'s picture of the same region ("B2:D4"), or [west, south, east, north] in degrees',
					),
				region: z
					.array(z.number())
					.min(4)
					.max(4)
					.optional()
					.describe(
						"With cells: the region of the view-mosaic picture they are from",
					),
				title: z.string().max(120).optional().describe("The session's title"),
				processing: z
					.string()
					.max(64)
					.optional()
					.describe(
						"A Mapflow processing's id: a session over its mosaic and area, to polish its result (with aoi, a part of it)",
					),
			},
		},
		{
			name: "image-status",
			title: "Interactive: Image status",
			description:
				"An image's size and ground pixel size, and how far the model has encoded its tiles, per scale (with preview,\n    its picture too); or an upload link's or satellite job's state.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES["image-status"],
			inputSchema: {
				image: z.string().optional().describe("An image name"),
				upload: z
					.string()
					.optional()
					.describe("An upload's id, from upload-image or add-image"),
				model: z
					.string()
					.optional()
					.describe("The model (default: the first local one)"),
				preview: z
					.boolean()
					.default(false)
					.describe(
						"With image: also a picture of the whole image, to see it before starting a session",
					),
			},
		},
		{
			name: "start-session",
			title: "Interactive: Start a session",
			description:
				"Starts a session: one task on one image. Returns its handle (sid), the live page link for the user, the image's\n    size, the model's capabilities and defaults, and the scales with their ground pixel size and number of tiles.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: "ui://mapflow-interactive/card.html" },
				"ui/resourceUri": "ui://mapflow-interactive/card.html",
				"openai/outputTemplate": "ui://mapflow-interactive/card.html",
			},
			route: ROUTES["start-session"],
			inputSchema: {
				image: z.string().describe("The image to work on"),
				model: fewshot
					? z
							.string()
							.optional()
							.describe(
								"The model: sam3 (SAM3, the default: separate objects from short texts and examples); or fewshot (Fewshots: a mask from + and − examples, no text: regions and textures, and what SAM3 misses). A session can use both: set-query and run take model",
							)
					: z
							.string()
							.optional()
							.describe(
								"The model: sam3 (SAM3, the default: separate objects from short texts and examples)",
							),
				intent: z.string().optional().describe("The task, if already clear"),
				client: z
					.string()
					.optional()
					.describe("Your client's name, if MCP doesn't report it"),
				copyQuery: z
					.object({
						session: z.string().max(40).optional(),
						run: z.string().max(8).optional(),
						config: z.string().max(200).optional(),
						library: z.string().max(200).optional(),
					})
					.optional()
					.describe(
						'Start from another session\'s query ({"session": "s4"[, "run": "r5"]}) or a saved config ({"config": "a name"}), to run it on this image',
					),
			},
		},
		{
			name: "set-intent",
			title: "Interactive: Set the task",
			description:
				"Records the interpretation the user agreed to, and the area of interest (detections are counted inside it,\n    and audit samples it).",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES["set-intent"],
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				text: z
					.string()
					.describe(
						"The agreed interpretation: what counts, edge cases, when to stop",
					),
				aoiBox: z
					.any()
					.optional()
					.describe('The area of interest: [x0, y0, x1, y1] or cells "B2:D4"'),
				aoiPolygon: z
					.any()
					.optional()
					.describe("The area of interest: [[x, y], ...]"),
				clearAoi: z.boolean().default(false),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
			},
		},
		{
			name: "view",
			title: "Interactive: View the image",
			description:
				"A picture of the image or a region: the run's outlines green with their numbers (edits' cyan), examples blue + and red −, the\n    area of interest yellow, a grid of labelled cells. k is image px per picture px.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.view,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				region: z
					.any()
					.optional()
					.describe(
						'[x0, y0, x1, y1] or cells "B2:C3"; default: the whole image',
					),
				aoi: z.boolean().default(false).describe("Show the area of interest"),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				hide: z
					.array(
						z.enum(["outlines", "labels", "grid", "examples", "aoi", "wand"]),
					)
					.optional()
					.describe("Layers to leave out"),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
			},
		},
		{
			name: "wand",
			title: "Interactive: Magic wand",
			description:
				'The magic wand: outlines an object from a point or a box. Answers w<k> and a small picture; run(add=["w<k>"]) uses it as an\n    example. A click takes a box of the run\'s typical object size; a box of your own fits objects unlike the rest.',
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.wand,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				points: z
					.array(z.any())
					.optional()
					.describe(
						"Several objects at once, for examples: [x, y] on each, or [x0, y0, x1, y1] its box",
					),
				include: z
					.array(z.any())
					.optional()
					.describe("One object: [x, y] on it"),
				exclude: z.array(z.any()).optional().describe("[x, y] not on it"),
				box: z.any().optional().describe("[x0, y0, x1, y1] around it"),
				w: z.string().optional().describe("A selection to refine, such as w2"),
				candidate: z.int().optional().describe("Another of its outlines (0-2)"),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
			},
		},
		{
			name: "run",
			title: "Interactive: Run the model",
			description:
				"Changes the query (only what you give) and runs it, waiting up to ~40 s. Answers the count, score and side_px as [min, q1, median,\n    q3, max], curve ([thr, count]: what each threshold would keep), by_text, and an overview. If still running, call wait.\n    A run's record is its template of the catalog and values in ground units (sam3-objects: dst_res m, threshold,\n    mask_threshold; fewshot-regions: dst_res, threshold, min_size).",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: "ui://mapflow-interactive/card.html" },
				"ui/resourceUri": "ui://mapflow-interactive/card.html",
				"openai/outputTemplate": "ui://mapflow-interactive/card.html",
			},
			route: ROUTES.run,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				texts: z
					.array(z.string())
					.optional()
					.describe(
						'Replaces the texts: short plain noun phrases, one per text ("tree", "car"); by_text says what each found',
					),
				add: fewshot
					? z
							.array(z.any())
							.optional()
							.describe(
								'Examples to add: "w3" or "r2.5" (+), "-r2.5" (−), or {polygon: [[x, y], ...], sign} drawn where the wand fails; fewshot also takes clicks: {point: [x, y], sign: "+" or "-"}',
							)
					: z
							.array(z.any())
							.optional()
							.describe(
								'Examples to add: "w3" or "r2.5" (+), "-r2.5" (−), or {polygon: [[x, y], ...], sign} drawn where the wand fails',
							),
				remove: z
					.array(z.string())
					.optional()
					.describe('Example ids to remove, or ["all"]'),
				thr: z
					.union([z.number(), z.literal("default")])
					.optional()
					.describe("Score threshold 0..1"),
				scale: z
					.literal([0.25, 0.5, 1, 2, 4])
					.optional()
					.describe(
						"Resolution the model sees: 2 or 4 for small objects, 0.5 or 0.25 for large ones and regions",
					),
				maskThr: z
					.union([z.number(), z.literal("default")])
					.optional()
					.describe(
						"Mask pixel threshold: lower when outlines stop short of the edges, higher when touching objects merge",
					),
				restore: z
					.string()
					.max(8)
					.optional()
					.describe(
						"First go back to the query of a run (r4); the other changes apply after it",
					),
				note: z
					.string()
					.max(300)
					.default("")
					.describe("A few words on why, for the user's log"),
				branch: z
					.string()
					.max(40)
					.optional()
					.describe("The line of work this run belongs to"),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
				overview: z
					.boolean()
					.default(true)
					.describe("Answer with a small overview of the run"),
				...(fewshot
					? {
							model: z
								.string()
								.max(32)
								.optional()
								.describe(
									"The model whose query this is, from start-session's models; each keeps its own, and it stays in use",
								),
						}
					: {}),
				...(fewshot
					? {
							r: z
								.union([z.int(), z.literal("default")])
								.optional()
								.describe(
									"fewshot: a click's brush radius in cells (0..20; default 2)",
								),
						}
					: {}),
				...(fewshot
					? {
							minSize: z
								.union([z.int(), z.literal("default")])
								.optional()
								.describe("fewshot: a region's least size in cells"),
						}
					: {}),
				...(fewshot
					? {
							refine: z
								.boolean()
								.optional()
								.describe(
									"fewshot: the wand's model redraws each region's outline",
								),
						}
					: {}),
			},
		},
		{
			name: "wait",
			title: "Interactive: Wait for a run",
			description: "Waits for a running run, as run does.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.wait,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				timeout: z
					.number()
					.gte(0)
					.lte(45)
					.default(45)
					.describe("Seconds, at most 45"),
			},
		},
		{
			name: "sheet",
			title: "Interactive: Contact sheet",
			description:
				"A contact sheet of a run's objects: each crop with its outline, number and score.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.sheet,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				pick: fewshot
					? z
							.enum([
								"random",
								"borderline",
								"boundary",
								"top",
								"bottom",
								"largest",
								"smallest",
								"not_in",
							])
							.default("random")
							.describe(
								"random (a precision check; finish needs one), borderline (around the threshold), top, bottom, largest, smallest, not_in (found here and not in other); boundary (points on the outlines' edges)",
							)
					: z
							.enum([
								"random",
								"borderline",
								"top",
								"bottom",
								"largest",
								"smallest",
								"not_in",
							])
							.default("random")
							.describe(
								"random (a precision check; finish needs one), borderline (around the threshold), top, bottom, largest, smallest, not_in (found here and not in other)",
							),
				n: z.int().gte(1).lte(48).default(24),
				seed: z.int().optional(),
				other: z
					.string()
					.max(8)
					.optional()
					.describe("not_in: the run to compare with"),
				selection: z
					.string()
					.max(12)
					.optional()
					.describe("Only this selection's objects (sel2)"),
				at: z
					.number()
					.gte(0)
					.lte(1)
					.optional()
					.describe(
						"borderline: around this threshold rather than the run's, to see where to set it",
					),
			},
		},
		{
			name: "audit",
			title: "Interactive: Audit cells",
			description:
				"Random cells of the area at full resolution with the run's outlines, to find objects nobody outlined (finish needs it, or\n    reviewed cells instead).",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.audit,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				cells: z.int().gte(1).lte(9).default(6),
				seed: z.int().optional(),
			},
		},
		{
			name: "audit-points",
			title: "Interactive: Audit points",
			description:
				"The points audit, for regions (finish takes it for a fewshot run). Without labels: random points, half inside the run's mask\n      and half outside, as numbered crops with a crosshair, showing nothing of the run. With labels: pixel precision, recall and IoU.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES["audit-points"],
			fewshot: true,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				n: z.int().gte(2).lte(64).default(40).describe("Points to sample"),
				seed: z.int().optional(),
				labels: z
					.record(z.string(), z.enum(["in", "out", "unsure"]))
					.optional()
					.describe(
						'Your label of each point by its number: {"1": "in", "2": "out"}; unsure leaves it out',
					),
				audit: z
					.string()
					.max(8)
					.optional()
					.describe("With labels: the sample (pa2)"),
			},
		},
		{
			name: "stats",
			title: "Interactive: Run statistics",
			description:
				"A run's numbers: count, total and covered area, sizes, density.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.stats,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				by: z
					.array(z.enum(["cells", "area"]))
					.optional()
					.describe("Also per grid cell, or per size"),
			},
		},
		{
			name: "filter",
			title: "Interactive: Filter a run",
			description:
				"Keeps a finished run's objects that pass, as the run r<k>f; they keep their ids.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.filter,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				minArea: z.number().gte(0).optional().describe("In unit"),
				maxArea: z.number().gte(0).optional().describe("In unit"),
				unit: z.enum(["px", "m2"]).default("px"),
				minScore: z.number().gte(0).lte(1).optional(),
				inAoi: z
					.boolean()
					.default(false)
					.describe("Only objects centred in the area of interest"),
				minCompactness: z
					.number()
					.gte(0)
					.lte(1)
					.optional()
					.describe(
						"4πA/P²: 1 a disc, 0.79 a square; low for slivers and strings",
					),
			},
		},
		{
			name: "finish",
			title: "Interactive: Finish the session",
			description:
				"Ends the session on a run that was checked (a random sheet, and audit or reviewed cells), commits pending edits: the final\n    overview, the summary on the live page, export links.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: "ui://mapflow-interactive/card.html" },
				"ui/resourceUri": "ui://mapflow-interactive/card.html",
				"openai/outputTemplate": "ui://mapflow-interactive/card.html",
			},
			route: ROUTES.finish,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				summary: z
					.string()
					.describe("The result: count or area, estimates, final query"),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				unverified: z
					.boolean()
					.default(false)
					.describe(
						"Finish unchecked: only for a quick count the user asked for",
					),
				save: z
					.string()
					.max(200)
					.optional()
					.describe(
						"Save the run as a config under this name: its recipe, examples and settings, to run on other images and at scale",
					),
			},
		},
		{
			name: "export",
			title: "Interactive: Export a run",
			description: "A download link for a run's results.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.export,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				format: z
					.enum(["geojson", "pixel", "mask", "mask_binary", "csv"])
					.default("geojson")
					.describe(
						"geojson (EPSG:4326), pixel (GeoJSON in image px), mask (PNG of instance numbers), mask_binary, csv",
					),
			},
		},
		{
			name: "import-layer",
			title: "Interactive: Import a layer",
			description:
				"A layer of polygons as a run to polish: GeoJSON, a GeoPackage or a zipped Shapefile, in any CRS, from a link or\n    its bytes, or a finished Mapflow processing's result by its id; each object keeps its class and score where it\n    has them. Answers the run as run does.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: true,
			},
			_meta: { "openai/fileParams": ["file"] },
			route: ROUTES["import-layer"],
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				url: z.string().max(4096).optional().describe("A link to the file"),
				content: z.string().optional().describe("The file's bytes in base64"),
				name: z
					.string()
					.max(255)
					.optional()
					.describe("The file's name, such as crowns.gpkg"),
				label: z
					.string()
					.max(60)
					.optional()
					.describe("The class of every object, if the file has none"),
				note: z.string().max(300).default(""),
				file: z
					.object({
						download_url: z.string(),
						file_id: z.string(),
						mime_type: z.string().optional(),
						file_name: z.string().optional(),
					})
					.optional()
					.describe("A file the user attached to the chat (ChatGPT passes it)"),
				processing: z
					.string()
					.max(64)
					.optional()
					.describe(
						"A finished Mapflow processing's id: its result, read as the user, in place of a file",
					),
				classes: z
					.array(z.string().max(60))
					.max(20)
					.optional()
					.describe("Only the objects of these classes (the layer's labels)"),
			},
		},
		{
			name: "save-layer",
			title: "Interactive: Save a run to the project",
			description:
				"Saves a run to the user's project as a new layer (its objects as the GeoJSON export has them); the import takes\n    a few seconds: with workflow, a save's state.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES["save-layer"],
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				name: z
					.string()
					.max(200)
					.optional()
					.describe("The layer's name in the project"),
				workflow: z
					.int()
					.optional()
					.describe("A save's workflow id: its state now"),
			},
		},
		{
			name: "publish",
			title: "Interactive: Publish a config",
			description:
				"Makes a saved config's workflow definition and registers it: on Mapflow, one of the user's own models there\n    (published again: a new version of it), to run as a processing over any of their imagery; on a test bed, with\n    its workflow-engine, to run at scale.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				openWorldHint: false,
			},
			route: ROUTES.publish,
			inputSchema: {
				config: z
					.string()
					.min(1)
					.max(200)
					.describe(
						"A saved config's name or id (finish(save=...) makes one; list-sessions names them)",
					),
			},
		},
		{
			name: "select",
			title: "Interactive: Select objects",
			description:
				'Selects a run\'s objects that meet every condition, as QGIS does by expression and location: answers sel<k>, its count and ids.\n    sheet(selection) shows them; edit(delete=["sel2"]) deletes them.',
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.select,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				region: z
					.any()
					.optional()
					.describe("Objects centred in this: [x0, y0, x1, y1] or cells"),
				polygon: z
					.any()
					.optional()
					.describe("Objects centred in this: [[x, y], ...]"),
				minArea: z.number().gte(0).optional().describe("In unit"),
				maxArea: z.number().gte(0).optional().describe("In unit"),
				unit: z.enum(["px", "m2"]).default("px"),
				minScore: z.number().gte(0).lte(1).optional(),
				maxScore: z.number().gte(0).lte(1).optional(),
				minCompactness: z
					.number()
					.gte(0)
					.lte(1)
					.optional()
					.describe(
						"4πA/P²: 1 a disc, 0.79 a square; low for slivers and strings",
					),
				maxCompactness: z.number().gte(0).lte(1).optional(),
				label: z.string().max(60).optional(),
				made: z
					.enum(["hand", "model"])
					.optional()
					.describe("hand: made by edits"),
				other: z.string().max(8).optional().describe("Another run, with how"),
				how: z
					.enum([
						"matched",
						"unmatched",
						"inside",
						"outside",
						"intersects",
						"near",
					])
					.optional()
					.describe(
						"With other: matched (IoU ≥ iou), unmatched, inside (centred on one of its objects), outside (not), intersects, near",
					),
				distance: z.number().gte(0).optional().describe("near: image px"),
				iou: z.number().gte(0.05).lte(1).default(0.5),
				mode: z
					.enum(["new", "add", "remove", "intersect"])
					.default("new")
					.describe("With selection"),
				selection: z
					.string()
					.max(12)
					.optional()
					.describe("With mode: such as sel2"),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
			},
		},
		{
			name: "edit",
			title: "Interactive: Edit objects",
			description:
				"All your edits to a run at once, as a reviewer makes them: numbers as the picture shows them (or ids). They stay pending until\n    changes(commit) or finish. What can't be done is reported and the rest is done. What the wand adds comes back on a small sheet;\n    odd names any far from the median size.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.edit,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				delete: z
					.array(z.any())
					.optional()
					.describe('False objects: [12, 15, "sel2"]'),
				add: z
					.array(z.any())
					.optional()
					.describe(
						'Objects without an outline of their own, one item each: [x, y] on it (the wand outlines it; two or more points inside one outline cut it there), [x, y, side] with its size in the picture\'s px, [x0, y0, x1, y1] its box, or "w3"',
					),
				merge: z
					.array(z.any())
					.optional()
					.describe("Pieces of one object: [[3, 4], [7, 8, 9]]"),
				split: z
					.array(z.any())
					.optional()
					.describe(
						"An outline over several objects: 12 cuts it at its necks; {id: 12, line: [[x, y], ...]} along a line, smooth through 3 or more points; {id, seeds: [[x, y], ...]} one in each part, cut along the edges between them; {id, parts: 3} blind, into equal areas",
					),
				reshape: z
					.array(z.any())
					.optional()
					.describe(
						"An outline again: {id, include: [[x, y]], exclude: [[x, y]], box} by the wand, or {id, points: [[x, y], ...]}",
					),
				copy: z
					.array(z.any())
					.optional()
					.describe('Another run\'s objects: ["r5.12", "sel3"]'),
				draw: z
					.array(z.any())
					.optional()
					.describe(
						"Only where the wand fails: [[x, y], ...], or {points, smooth: true} for 6-16 control points",
					),
				label: z
					.record(z.string(), z.any())
					.optional()
					.describe('{ids: [...], to: "car"}'),
				run: z
					.string()
					.max(8)
					.optional()
					.describe(
						"The run to edit; default: the pending edits, else the last",
					),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
				show: z
					.boolean()
					.default(false)
					.describe("Also picture merges and splits"),
				note: z.string().max(200).default("").describe("A few words on why"),
			},
		},
		{
			name: "changes",
			title: "Interactive: Pending edits",
			description:
				"The pending edits. Model runs, filter, transform, combine and finish commit them by themselves.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.changes,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				action: z
					.enum(["show", "undo", "commit", "discard"])
					.default("show")
					.describe("undo takes back the last n edit calls"),
				n: z.int().gte(1).lte(50).default(1),
				note: z.string().max(300).default("").describe("commit: a few words"),
			},
		},
		{
			name: "transform",
			title: "Interactive: Transform a run",
			description:
				"All of a run's objects through one post-processing step, as a new run: unchanged objects keep their ids.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.transform,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				op: z
					.enum([
						"buffer",
						"opening",
						"closing",
						"fill_holes",
						"simplify",
						"smooth",
						"rectangles",
						"convex_hull",
						"remove_overlaps",
						"merge_slivers",
						"dissolve",
						"split_necks",
					])
					.describe(
						"split_necks (cut two-lobed outlines at their necks; round objects only, as it ruins long ones), opening (remove spurs), closing (fill notches), buffer, fill_holes (up to maxArea), simplify, smooth, rectangles (buildings), convex_hull, remove_overlaps, merge_slivers (up to maxArea), dissolve (touching objects as one: regions)",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				selection: z
					.string()
					.max(12)
					.optional()
					.describe("Only this selection's objects"),
				distance: z.number().gte(-500).lte(500).optional().describe("In unit"),
				unit: z
					.enum(["px", "m"])
					.default("px")
					.describe("Lengths in image px or m (areas: px², m²)"),
				maxArea: z.number().gte(0).optional().describe("In unit²"),
				tolerance: z
					.number()
					.lte(100)
					.gt(0)
					.optional()
					.describe("simplify: image px"),
				iterations: z.int().gte(1).lte(5).default(2).describe("smooth"),
				minIou: z.number().gte(0.3).lte(1).default(0.8).describe("rectangles"),
				note: z.string().max(200).default(""),
			},
		},
		{
			name: "combine",
			title: "Interactive: Combine runs",
			description:
				"Combines finished runs into a new run; their objects keep their ids.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.combine,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				runs: z
					.array(z.string())
					.min(2)
					.max(8)
					.describe("Runs, the first leading"),
				mode: z
					.enum(["fill", "intersect", "vote", "replace", "subtract", "seed"])
					.describe(
						"fill (the first, plus the others' objects it lacks), intersect (the first's that every other has), vote (those k of the runs have), replace (the second's in place of the first's within region or polygon), subtract (regions only), seed (the first, plus the wand's outlines of what the second's regions add to it, as a selection to judge)",
					),
				iou: z
					.number()
					.gte(0.1)
					.lte(0.95)
					.default(0.5)
					.describe("How much two outlines overlap to be one object"),
				k: z.int().gte(2).lte(8).optional().describe("vote: how many runs"),
				region: z
					.any()
					.optional()
					.describe("replace: [x0, y0, x1, y1] or cells"),
				polygon: z.any().optional().describe("replace: [[x, y], ...]"),
				note: z.string().max(200).default(""),
				preview: z
					.string()
					.max(12)
					.optional()
					.describe(
						'The picture the numbers are in, such as p4; default: the last; "image": image pixels',
					),
				...(fewshot
					? {
							cover: z
								.number()
								.lte(1)
								.gt(0)
								.optional()
								.describe(
									"fill: also leave out what the first's objects already cover this share of, as a fewshot region over several objects (0.3)",
								),
						}
					: {}),
				...(fewshot
					? {
							minScore: z
								.number()
								.gte(0)
								.lte(1)
								.optional()
								.describe(
									"seed: the wand's own score an addition needs (0.75)",
								),
						}
					: {}),
			},
		},
		{
			name: "review",
			title: "Interactive: Review a run",
			description:
				"The polish: applies fix to what was last shown and answers the next part, so one call a part. Its progress is kept here; reviewed cells count as audit\n    cells.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			route: ROUTES.review,
			inputSchema: {
				sid: z
					.string()
					.max(40)
					.describe(
						"The session's handle from start-session, such as s4: this server's own name for the session, not a credential",
					),
				fix: z
					.record(z.string(), z.any())
					.optional()
					.describe(
						"The edits for the part last shown, as edit takes them: {delete, add, split, merge, ...}; points in that picture",
					),
				run: z
					.string()
					.optional()
					.describe(
						"A run such as r3; default: the pending edits, else the last run",
					),
				by: z
					.enum(["large", "cells", "disagreements"])
					.optional()
					.describe(
						"large: the largest outlines, 20 on a picture; cells: the area cell by cell; disagreements: the objects this run and other don't share. Default: go on with the review under way, else cells",
					),
				other: z
					.string()
					.max(8)
					.optional()
					.describe("disagreements: the other run"),
				cell: z
					.int()
					.gte(32)
					.lte(8192)
					.optional()
					.describe(
						"Image px a cell covers; default: as keeps objects legible",
					),
				restart: z.boolean().default(false).describe("Start over"),
			},
		},
		{
			name: "upload-image",
			title: "Interactive: Upload a GeoTIFF",
			description:
				"Puts a GeoTIFF the user has (attached to the chat, or on their computer) into their MyImagery, as a new mosaic.\n    ChatGPT passes its attachment as file. Otherwise the answer is an upload link: send the file from your code\n    sandbox with its send command, or the user drops it on the card shown in the chat. Follow with\n    image-status(upload=...) until it is ready.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: {
				ui: { resourceUri: "ui://mapflow-interactive/session.html" },
				"ui/resourceUri": "ui://mapflow-interactive/session.html",
				"openai/outputTemplate": "ui://mapflow-interactive/session.html",
				"openai/fileParams": ["file"],
			},
			route: ROUTES["upload-image"],
			inputSchema: {
				file: z
					.object({
						download_url: z.string(),
						file_id: z.string(),
						mime_type: z.string().optional(),
						file_name: z.string().optional(),
					})
					.optional()
					.describe("A file the user attached to the chat (ChatGPT passes it)"),
				fileName: z
					.string()
					.max(255)
					.optional()
					.describe(
						"The file's name, when you know it: the card checks the user gives that one",
					),
				fileSize: z
					.int()
					.gte(1)
					.optional()
					.describe("Its size in bytes, when you know it"),
				sha1: z
					.string()
					.regex(/^[0-9a-fA-F]{40}$/)
					.optional()
					.describe(
						"Its SHA-1, when you can compute it (code execution): a file already in the user's MyImagery isn't sent again",
					),
				name: z
					.string()
					.max(120)
					.optional()
					.describe("The new mosaic's name (default: the file's)"),
			},
		},
		{
			name: "upload-refresh",
			title: "Interactive: Renew an upload link",
			description:
				"For the card in the chat only, just before it sends the user's file through an upload link.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				openWorldHint: false,
			},
			_meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
			route: ROUTES["upload-refresh"],
			inputSchema: {
				upload: z.string().max(40).describe("The upload's id"),
			},
		},
	];
	return tools.filter((tool) => fewshot || !tool.fewshot);
}
