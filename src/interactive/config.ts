// Mapflow Interactive's settings: off unless MAPFLOW_INTERACTIVE_URL is set.

export type InteractiveConfig = {
	/** The app's address: https, or http on a loopback host (a local version). */
	baseUrl: string;
	/** How long a call may take; `run` and `wait` answer within 45 s. */
	timeoutMs: number;
	/** Fewshots' tool and arguments, where the app serves a Fewshot model. */
	fewshot: boolean;
	/** Where the card in the chat may load images from besides the app: Mapflow's map tiles and previews. */
	imageOrigins: string[];
};

const LOCAL = ["localhost", "127.0.0.1", "[::1]"];

const seconds = (value: string | undefined, fallback: number, max: number) => {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

const origin = (raw: string, name: string) => {
	const url = new URL(raw);
	if (
		url.protocol !== "https:" &&
		!(LOCAL.includes(url.hostname) && url.protocol === "http:")
	)
		throw new Error(`${name} must be an https URL`);
	return url;
};

/** MAPFLOW_INTERACTIVE_URL, MAPFLOW_INTERACTIVE_TIMEOUT_SECONDS (60), MAPFLOW_INTERACTIVE_FEWSHOT (on unless 0 or
 * false) and MAPFLOW_INTERACTIVE_CARD_IMAGES (origins, comma-separated; MAPFLOW_BASE_URL's by default). */
export function readInteractiveConfig(
	env: Record<string, string | undefined>,
): InteractiveConfig | undefined {
	const raw = env.MAPFLOW_INTERACTIVE_URL?.trim();
	if (!raw) return undefined;
	const url = origin(raw, "MAPFLOW_INTERACTIVE_URL");
	if (url.search || url.hash || url.username || url.password)
		throw new Error("MAPFLOW_INTERACTIVE_URL is an address only");
	const fewshot = !["0", "false", "no", "off"].includes(
		(env.MAPFLOW_INTERACTIVE_FEWSHOT ?? "").trim().toLowerCase(),
	);
	const images = env.MAPFLOW_INTERACTIVE_CARD_IMAGES?.trim()
		? env.MAPFLOW_INTERACTIVE_CARD_IMAGES.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: env.MAPFLOW_BASE_URL?.trim()
			? [env.MAPFLOW_BASE_URL.trim()]
			: [];
	return {
		baseUrl: url.href.replace(/\/+$/, ""),
		timeoutMs: seconds(env.MAPFLOW_INTERACTIVE_TIMEOUT_SECONDS, 60, 600) * 1000,
		fewshot,
		imageOrigins: images.map(
			(s) => origin(s, "MAPFLOW_INTERACTIVE_CARD_IMAGES").origin,
		),
	};
}
