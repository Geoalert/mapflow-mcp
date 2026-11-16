// The app's answers say what to do next as a step and its values ({"step": "save-layer-state", "workflow": 8123}, or
// a list of them); these are its words, said in the answer's place, with the prose an answer names by a key and the
// models' cards. Ported from the app's agent/steps.py (2026-11-16), word for word; next.test.ts checks every step
// against the app's own words (fixtures/interactive/next-steps.json).

import { CARDS, PROSE } from "./prose.js";

type Values = Record<string, unknown>;

/** Python's repr of a string, as the app's texts quoted names: '…', or "…" when it holds a ' and no ". */
export function pyRepr(value: unknown): string {
	const s = String(value);
	const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
	let out = s
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t");
	if (quote === "'") out = out.replaceAll("'", "\\'");
	return `${quote}${out}${quote}`;
}

/** Python's str of a value, as the app's texts put one in: None for a missing one. */
const str = (value: unknown) =>
	value === null || value === undefined ? "None" : String(value);

const UPLOAD_AGAIN: Record<string, string> = {
	"same-link": "the same link takes the file again until it expires",
	"new-link": "upload-image makes a new link",
	attachment:
		"upload-image with the attachment tries again, or without it gives a link",
};

export const WORDS: Record<string, (v: Values) => string> = {
	"list-sessions-local": () =>
		'start-session(image=<an image>, copyQuery={"config": <a saved config\'s name>}) starts from a config; publish(config=...) makes its WD, start-processing runs it over an image',
	"list-sessions": () =>
		"start-session(image=<a session's name>) works on one as it is, with copyQuery={\"config\": <a saved config's name>} to start from that config; a new session is made from the user's MyImagery (list-mosaics)",
	"list-images": () =>
		"the user sees these on the card in the chat (claude.ai, ChatGPT), each image's preview under its mosaic; a click on an image or a mosaic opens its map to pick the area on, whose “Use this area” writes the mosaic and the area into the chat for add-image(mosaic, aoi). Where no card shows, view-mosaic. The sessions already made from them: list-sessions",
	"list-images-empty": () =>
		"no mosaics in the user's MyImagery yet: upload-image puts a GeoTIFF they have there",
	"satellite-job": () => "follow it with image-status(job=...)",
	"upload-card": () =>
		"in claude.ai and ChatGPT the user picks the file on the card shown with this answer, which then tells you in the chat; give them the link as well, for other clients or if the card fails. Then image-status(upload=...).",
	"view-mosaic-ok": () =>
		"add-image with this mosaic and aoi makes the session",
	"view-mosaic-change": (v) => `change the area: ${str(v.problem)}`,
	"view-mosaic-agree": () =>
		'agree an area with the user; give it as cells of this picture ("B2:D4", with the same region) or [west, south, east, north], and check it with view-mosaic(aoi=...)',
	"select-area": (v) => {
		const how = v.marked
			? `the whole mosaic is marked on it (${str(v.tiles)} tiles at ×1)`
			: "the user draws the area on it (the whole mosaic is too large for one session at ×1)";
		return `the user sees the mosaic's map on the card shown in the chat (claude.ai, ChatGPT); ${how}. The card checks the area, and its “Use this area” writes the mosaic and the area into the chat: then add-image(mosaic, aoi) with them, image-status until it is ready, and start-session. If the user sees no card, show the mosaic with view-mosaic and agree the area as cells of its picture`;
	},
	"add-image": (v) => {
		let after = `image-status(image=${pyRepr(v.image)}) until it is ready, then start-session`;
		if (v.processing !== undefined && v.processing !== null) {
			const status = v.processingStatus;
			after +=
				`, then import-layer(sid, processing=${pyRepr(v.processing)}) to bring its objects in` +
				(status === "OK"
					? ""
					: ` once the processing is done (it is ${str(status)} now)`);
		}
		return after;
	},
	"upload-ready": (v) =>
		`the image is in MyImagery${v.existing ? " already" : ""}, in the mosaic ${pyRepr(v.mosaicName)} (${str(v.mosaicId)}): select-area(mosaic=${pyRepr(v.mosaicId)}) shows the user its map to pick the area on (claude.ai, ChatGPT; elsewhere view-mosaic), then add-image(mosaic, aoi)`,
	"upload-processing": () =>
		"MyImagery is checking the file and making its map layer (a minute or more for a large one): image-status(upload=...) again in a few seconds",
	"upload-receiving": () =>
		"the file is on its way to MyImagery: image-status(upload=...) again in a few seconds",
	"upload-failed": (v) =>
		`it failed: ${str(v.error).replace(/\.+$/, "")}. Tell the user; ${UPLOAD_AGAIN[String(v.again)] ?? ""}`,
	"upload-expired": () =>
		"the link expired before a file came: upload-image makes a new one",
	"upload-send": () =>
		"send the file through upload_url, whichever way works: (1) the file is in your code sandbox (claude.ai: /mnt/user-data/uploads/...): run the send command there; it reaches this server only if the user allowed its host in claude.ai's Settings → Capabilities → Additional allowed domains; (2) otherwise the user drops the same file on the card shown in the chat (claude.ai, ChatGPT), which then tells you; (3) Claude Code or Codex: the send command with the local file; (4) any other client: give the user upload_url, a page to pick the file on. Then image-status(upload=...) until it is ready",
	"start-session": (v) =>
		"tell the user the live page link and view the whole image; " +
		(v.copied
			? "the query is copied: run it, then review it as usual"
			: "then write down your interpretation and wait for the user's OK before set-intent") +
		(v.kind === "boxes"
			? `. ${str(v.model)} works differently from SAM3: follow model.workflow in place of the workflow's steps 3 to 7`
			: v.kind === "fewshot"
				? `. ${str(v.model)} works differently: follow model.workflow in place of the workflow's steps 3 to 7`
				: ""),
	wait: (v) => `wait(sid, run="${str(v.run)}") for the rest`,
	"fewshot-uses": (v) =>
		`Two uses, one call each: select(run="${str(v.main)}", other="${str(v.run)}", how="outside") finds ${str(v.main)}'s outlines off this mask, to judge on a sheet; combine(runs=["${str(v.main)}", "${str(v.run)}"], mode="seed") outlines what it adds. Don't judge the mask by its look: one that merges objects or lies over a whole forest did well on the benches. Judge what comes of it`,
	"mapflow-models": () =>
		"run one with run-mapflow-model(sid, model, switches) in a session, as a run to compare with the session's other runs; its blocks' switches are on or off as shown unless you set them",
	"mapflow-models-none": () =>
		"none runs in a session here: SAM3 and Fewshots are the models",
	"run-mapflow-model": () =>
		"check it as any run (sheet, audit) and compare it with the session's other runs; the user runs it over more imagery as a processing on Mapflow",
	"label-points": (v) =>
		`label every point from its crop: is the pixel under the crosshair's centre what the intent counts? The crops show nothing of the run, so judge the image alone. Then audit-points(sid, run="${str(v.run)}", audit="${str(v.audit)}", labels={"1": "in", "2": "out", ...}); "unsure" leaves a point out`,
	"polish-layer": () =>
		'polish it: review(by="large") first, then the misses; the random sheet and the audit; finish',
	"save-layer-state": (v) =>
		`the import takes a few seconds: save-layer(workflow=${str(v.workflow)}) gives its state`,
	finish: (v) =>
		"report the count or area with your estimates (or that it is unchecked), the final query and these links" +
		(v.offerSave
			? '; offer to save the run as a config (finish again with save="a name"), which runs on other images (start-session with copyQuery={"config": "the name"})'
			: ""),
	"publish-mapflow": (v) =>
		`it is in the user's models as "${str(v.displayName)}" (list-models lists it): to run it over a mosaic, calculate-cost and then, with the user's OK, start-processing with that model, the mosaic as the imagery ({"type": "myImagery", "mosaicId": ...}) and its geometryId from get-mosaic`,
	"publish-scale": (v) =>
		`start-processing(config="${str(v.config)}", image=...) runs it over a whole image`,
	"run-at-scale-started": (v) =>
		`start-processing(config="${str(v.config)}") again for its state; it takes minutes`,
	"run-at-scale-running": () => "still running: ask again in a minute",
	selection: (v) =>
		`sheet(selection="${str(v.selection)}") to look at them; edit(action="delete" or "label", selection="${str(v.selection)}")`,
	"seed-judge": (v) =>
		`sheet(selection="${str(v.selection)}") to judge them; if they are mostly wrong, edit(delete=["${str(v.selection)}"])`,
	"seed-left": (v) =>
		`combine(runs=["${str(v.run)}", "${str(v.regions)}"], mode="seed") does the ${str(v.left)} seeds left`,
	"review-cells": () =>
		"Call review(fix={delete: [numbers], add: [[x, y], ...], split: [...], merge: [[...]]}) with this cell's edits, its points in this picture's pixels: it applies them and shows the next cell.",
	"review-large": () =>
		"For each outline over two or more objects (a waist, lobes, two tops): review(fix={add: [[x, y], [x, y], ...]}) with one point on each object in it, in this picture's pixels: it cuts them there, along the edges between them, and shows the next. Delete what isn't an object in the same fix. Go on until it says done.",
	"review-disagreements": () =>
		"review(fix={delete: [the wrong ones of in_run], copy: [the right ones of from_other]}) applies them and goes on",
};

const isStep = (value: unknown): value is Values & { step: string } =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	typeof (value as Values).step === "string" &&
	((value as Values).step as string) in WORDS;

/** `next` said: a step's words, a list's joined by "; "; anything else as it is. */
export function wordNext(value: unknown): unknown {
	if (Array.isArray(value) && value.length > 0 && value.every(isStep))
		return value.map((v) => wordNext(v)).join("; ");
	if (isStep(value)) {
		const { step, ...values } = value;
		return WORDS[step]?.(values) ?? "";
	}
	return value;
}

/** An answer as the model reads it: every `next` worded, every prose key and model card filled in, in place. */
export function worded(data: unknown): unknown {
	if (Array.isArray(data)) return data.map(worded);
	if (typeof data !== "object" || data === null) return data;
	const out: Values = {};
	for (const [key, value] of Object.entries(data as Values)) {
		if (key === "next") out[key] = wordNext(value);
		else if (key === "workflow" && typeof value === "string" && value in PROSE)
			out[key] = PROSE[value];
		else if (
			key === "model_card" &&
			typeof value === "string" &&
			value in CARDS
		)
			Object.assign(out, CARDS[value]);
		else out[key] = worded(value);
	}
	return out;
}
