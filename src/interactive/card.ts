// The card in the chat (MCP Apps, `ui://`): Mapflow Interactive's session map, its MyImagery previews, an area
// picker and its upload box, which claude.ai and ChatGPT show inline. One self-contained page: Leaflet, the card's
// script and its styles inlined, so the sandbox loads no scripts from elsewhere. It reads the session's data from the
// app (`/agent/<sid>/...`, with the key the card's `_meta` carries) and calls the tools through the host. Moved from
// the app's agent/widget.py and static/ (2026-11-16); its address never changes, since hosts keep a page they read.

import type { InteractiveConfig } from "./config.js";

export const CARD_URI = "ui://mapflow-interactive/card.html";
export const CARD_MIME = "text/html;profile=mcp-app";
/** A result's `_meta` key: what the card is to show ({tool, sid, run, card, key}). */
export const RESULT_META = "mapflow-interactive/widget";
/** The `_meta` of a tool whose results the card shows. */
export const CARD_TOOL_META = {
	ui: { resourceUri: CARD_URI },
	"ui/resourceUri": CARD_URI,
	"openai/outputTemplate": CARD_URI,
};
export const BRAND = "Mapflow interactive";

const asset = (path: string) =>
	Bun.file(new URL(`./card/${path}`, import.meta.url))
		.text()
		.then((text) => text.replaceAll("\r\n", "\n"));
// Leaflet's stylesheet names marker and layer-control images the card never uses; the sandbox would fail on them.
const UNUSED_IMAGES = /url\(images\/[^)]*\)/g;

const origin = (url: string) => new URL(url).origin;

let built: Promise<string> | undefined;

/** The page, made once: the app's address for its requests, Leaflet, the script and the styles. */
export function cardPage(config: InteractiveConfig): Promise<string> {
	built ??= (async () => {
		const [leafletCss, css, leafletJs, js] = await Promise.all([
			asset("vendor/leaflet/leaflet.css"),
			asset("widget.css"),
			asset("vendor/leaflet/leaflet.js"),
			asset("widget.js"),
		]);
		for (const text of [leafletJs, js])
			if (text.toLowerCase().includes("</script"))
				throw new Error("an inlined script contains </script");
		const settings = JSON.stringify({
			base: config.baseUrl,
			brand: BRAND,
			platform: true,
		}).replaceAll("</", "<\\/");
		return (
			'<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' +
			'<meta name="viewport" content="width=device-width, initial-scale=1">' +
			`<title>${BRAND} session</title><style>${leafletCss.replace(UNUSED_IMAGES, "none")}</style><style>${css}</style></head>` +
			'<body><div id="app"></div>' +
			`<script type="application/json" id="mapflow-interactive-config">${settings}</script>` +
			`<script>${leafletJs}</script><script>${js}</script></body></html>\n`
		);
	})();
	return built;
}

/** Forgets the page made (tests make it for another app). */
export function resetCardPage() {
	built = undefined;
}

/** The page's `_meta`: the domains its sandbox may reach (the app for its data; the app and Mapflow for images), in
 * the standard form and ChatGPT's older one, and ChatGPT's display modes (inline unless asked). */
export function cardMeta(config: InteractiveConfig) {
	const app = origin(config.baseUrl);
	const images = [app, ...config.imageOrigins.filter((o) => o !== app)];
	return {
		ui: {
			csp: { connectDomains: [app], resourceDomains: images },
			prefersBorder: true,
		},
		"openai/widgetCSP": { connect_domains: [app], resource_domains: images },
		"openai/widgetPrefersBorder": true,
		"openai/ui": {
			availableDisplayModes: ["inline", "fullscreen"],
			preferredDisplayMode: "inline",
		},
	};
}
