// Written once from Mapflow Interactive's last tool list (its app's door, mi-6/mi-7) by the app's
// scripts/port_platform_mcp.py on 2026-11-16 (PLAN.md, "one MCP"); kept here by hand from then on.
// The instructions and the prompts of Mapflow Interactive's tools, with a Fewshot model's part where
// `fewshot`; the joint block before the instructions is index.ts's.

export const instructions = (fewshot: boolean): string =>
	`Finding and outlining custom objects on the user's Mapflow imagery (their MyImagery mosaics) with SAM3 and Fewshots, as on Mapflow interactive's session page: the kinds of objects the user's existing models and configs on Mapflow don't cover. Work in a session (start-session) on one image; its id is a short handle such as s4. Give the user its live page link. The prompt find-objects has the full workflow; in short:
1. Get the image. list-mosaics lists the user's MyImagery mosaics and shows the user each mosaic's images on a card in the chat (get-mosaic gives one's footprint); a GeoTIFF the user attached or has: upload-image puts it into their MyImagery as a new mosaic (ChatGPT passes the attachment as file; elsewhere follow its answer's next: send the file from your code sandbox or the user's computer, else the user drops it on the card in the chat; a file over its limits.max_file the user uploads on Mapflow's My data page, my_data), then image-status(upload=...) until it is ready. list-sessions lists their sessions (a mosaic cut to an area; use one the user names as it is). The area: a mosaic or an image the user clicks on list-mosaics' card, or select-area(mosaic) for one they name, opens its map on the card, whose “Use this area” writes the mosaic and the area into the chat; without a card, view-mosaic shows the mosaic with labelled cells to agree the area on, and view-mosaic(aoi=...) checks it. Then add-image(mosaic, aoi), image-status until it is ready, start-session and view it.
2. Write your interpretation for the user (what counts with the edge cases, the area of interest, objects or regions and their size, when to stop) and wait for their OK before set-intent.
3. Then, cheaply: run(texts=["tree"], thr=0.3, scale=2) with plain nouns (by_text says what each finds; curve what each threshold keeps), ×2 for objects under ~100 px; examples only for a kind that is missed or a dense scene: wand(points=[[x, y], ...]), then run(add=["w1", "w2"]).
4. Then polish: review(by="large") shows the largest outlines; review(fix={add: [[x, y], [x, y]]}) with a point on each object inside one that holds several cuts it there, and shows the next, which is what most raises the score. review(by="cells") goes over the area if objects are visibly missing; a point on one the wand outlines. edit makes the same edits outside a review; combine, transform and select work on whole runs. Finish commits the edits.
5. Before you report a number: sheet(pick="random") (an outline over two objects or part of one is wrong) and the reviewed cells (else an audit of 6): estimates with their sample sizes. Then finish.
Bare numbers are in the last picture's pixels. Other models have their own steps when start-session's answer has model.workflow.
Polishing (the prompt polish-results, which import-layer's first answer carries too) fixes any layer of objects: a session's round; a file (GeoJSON, a GeoPackage, a zipped Shapefile), which import-layer makes a run; or a processing's result on the user's MyImagery, from one of their Mapflow models or a published config: add-image(processing=...) makes its session and import-layer(sid, processing=...) brings its objects in. save-layer puts any run into the user's project; publish makes a saved config one of the user's models on Mapflow, to run over more of their imagery.` +
	(fewshot
		? `
Fewshots, beside SAM3: start-session's models has each model's card. Fewshots (model "fewshot") classifies the image's pixels from your + and − examples alone, no text. Its regions aren't objects, as touching ones merge, so for objects it works through SAM3: combine(mode="seed") outlines what it adds, and select(how="outside") finds SAM3's outlines off it. Regions and textures take it on its own. run(model="fewshot", add=[...]) works on its own query (the first answer has its steps); run(model="sam3") goes back. Its runs are layers like any other. finish takes audit-points for its regions.`
		: ``) +
	``;

export const find_objects = (fewshot: boolean): string =>
	`You find and outline objects on an aerial or satellite image with SAM3 and Fewshots, through Mapflow interactive's tools, the way its users work on its session page. It is for custom objects: the kinds the user's existing models and configs on Mapflow don't cover; a kind one of them is made for runs as a processing of that model instead. Work in one session (start-session; its id is a short handle such as s4) and give the user the live page link from it: they can watch every run there and open it on the session page.

1. Intake. The images are sessions: one of the user's MyImagery mosaics cut to an area of interest.
   - The user's mosaics: list-mosaics lists them (get-mosaic gives one's footprint, get-mosaic-status its images), and shows the user each mosaic's images' previews on its card in the chat: to show the user their images, call it, rather than showing pictures of them one by one. list-sessions lists the sessions already made (a mosaic cut to an area), newest first: use one the user names as it is.
   - A file the user has (they attached a GeoTIFF to the chat, or name one on their computer): upload-image puts it into their MyImagery as a new mosaic named after it. ChatGPT passes the attachment as file. Elsewhere pass fileName and fileSize, and sha1 if you can compute it (a file already in MyImagery isn't sent again), then follow the answer's next: send the file with its send command from your code sandbox (claude.ai: /mnt/user-data/uploads/...; it reaches the service only if the user allowed its host, so if the command fails, don't retry it: the user drops the same file on the card in the chat) or from the user's computer (Claude Code, Codex). image-status(upload=...) until it is ready: MyImagery checks the file and makes its map layer, a minute or more for a large one. MyImagery takes only georeferenced GeoTIFFs, and the service files up to the answer's limits.max_file: a larger one the user uploads on Mapflow's My data page (the answer's my_data), and you take its mosaic from list-mosaics.
   - The area: a mosaic or an image the user clicks on list-mosaics' card opens its map there, and select-area(mosaic) shows a mosaic they name on a card in the chat (claude.ai, ChatGPT): the whole mosaic or image is marked when it fits one session, else they draw the area; the card checks it. Its “Use this area” sends a message with the mosaic and the area as [west, south, east, north]: pass them to add-image as they are. Without a card (other clients, or the user sees none): view-mosaic(mosaic) shows the map with its images' outlines and labelled cells (region=[west, south, east, north] zooms in); agree the area with the user as cells of that picture ("B2:D4", with the same region) or in degrees, and view-mosaic(mosaic, aoi=...) checks it: the session's size, ground pixel size and tiles per scale (a prompt runs only at a scale within max_tiles).
   - add-image(mosaic, aoi, title) makes the session; it counts towards the user's sessions of the day. Wait until image-status says it is ready. Then view the whole image.

2. Intent. Write your interpretation for the user, briefly:
   - what counts, with the edge cases ("short dead trees count, shrubs don't");
   - the area of interest (a part of the image, or all of it);
   - whether these are objects (cars, trees, buildings) or regions (water, fields, forest), and the size of one in pixels;
   - when to stop (e.g. "precision and recall both look ≥ 90%").
   Then stop and wait for the user's answer. Call set-intent only once they have corrected or OK'd it (with the area of interest, which you can give as cells of a preview's grid). Go on without an answer only if the user said up front that you should, or that they can't answer; then say what you assumed.

3. The phrase and the scale, cheaply: these and the threshold move the score far more than anything after them. run(texts=["tree", "forest"], note="..."): plain nouns of one or two words, several at once if unsure, one per text. by_text says what each finds, and the model ignores what it doesn't know ("tree crown" finds nothing where "tree" finds hundreds). Small words matter too: "solar panels" scored 0.58 where "solar panel" scored 0.19, "vehicle" 0.86 where "car" scored 0.80, so try the plural and a more general word. Then the scale: the model does best where the typical object is 50 to 100 px across at the scale, so ×4 for objects of about 20 px in the image, ×2 for 25 to 50, ×1 for 50 and over. side_px gives the size, and scale_hint says when a run is off. On the benches this rule lost at most 0.04 of F1 against the best scale; always ×2 lost up to 0.28, and on objects of 20 px ×4 gave 0.78 where ×2 gave 0.51, with no other help. Too fine merges them: 0.80 fell to 0.44 at ×4 on objects of 50 px. Regions (water, fields, forest), ÷2 or ÷4. Each run answers curve (what each threshold would keep) and a small overview.

4. The threshold. It can go either way from 0.5, 0.15 to 0.8 on the benches, and often should go up: where a random sheet shows false ones, raise it (vehicles 0.67 at 0.5, 0.86 at 0.8; solar panels 0.49 at 0.5, 0.58 at 0.7), and where many are missed lower it (dense small trees 0.61 at 0.5, 0.78 at 0.25). sheet(pick="borderline", at=0.4) shows the objects around a threshold with no run for it, curve how many it would keep; set thr where they turn from right to wrong. One or two sheets are enough: what is left costs one delete later.

5. Examples, only when a kind is missed or a dense scene gives few objects: they can do far more than any threshold there, and elsewhere often make things worse, so skip them if the text does well. wand(points=[[x, y], ...]) on 2 or 3 objects that look different, then run(add=["w1", "w2"]); compare with the run before on a random sheet, and go back with run(restore="r4") if it is no better. Negatives ("-r2.7") can suppress real objects too: delete in the polish rather. Stop at the second run that doesn't clearly help: what is left is cheaper to fix by hand. Other things that may help, one call each: combine(mode="fill") when two runs find different objects; a slightly lower maskThr when outlines stop short of the edges; filter by size or compactness only for a clear kind of junk, as it took real objects with it on the benches. Only where the wand fails, draw: edit(draw=[{"points": [[x, y], ...], "smooth": true}]).

6. ` +
	(fewshot
		? `Fewshots, only if, at the right scale, many outlines are still false or many objects have no outline. Fewshots classifies the image's pixels from your + and − examples, no text. Its regions merge touching objects, and its mask can look blotchy or lie over a whole forest: judge what comes of it, not its look. run(model="fewshot", add=[...]): + on objects, − on what surrounds them and what looks like them; its first answer has its steps. Then, one call and one sheet each:
   - Many false outlines: select(run="r3", other="r9", how="outside") and a sheet of those; delete them if they are wrong. With clicks well placed it raised F1 from 0.80 to 0.97 and from 0.83 to 0.87, and it cost real objects where the mask covered little.
   - Objects with no outline: combine(runs=["r3", "r9"], mode="seed") adds the wand's outlines of what the mask adds, as a selection; judge one sheet of it, and edit(delete=["sel4"]) if mostly wrong. It gains little once the scale is right (0.78 to 0.80).
Regions and textures (water, fields, forest, roads, bare soil) take Fewshots on its own. run(model="sam3") goes back to SAM3.

7. The polish, on the round you chose (say which and why: the polish starts from it, and its config, finish(save=...), keeps the steps up to it, not the edits after it); from here these are the steps of the prompt polish-results, kept short: in real sessions on the benches it moved F1 by -0.07 to +0.05, and lost when it cut what was one object.
   - First the merged outlines: review(by="large") shows the largest, 20 on a picture, close up, two pictures in all. A quarter to a half of them hold two or more objects. Cut those you can see are several: a waist, lobes, several tops; a needless cut costs about as much as a missed one. For each, review(fix={add: [[x, y], [x, y]]}) with one point on each object in it, in that picture's pixels: it cuts there, along the edges between them, and shows the next. A point on each scored up to 0.16 higher on the benches than saying only how many ({split: [{id: "r3.12", parts: 2}]}), so that is for when you can't tell where. Delete what is no object in the same fix ({delete: ["r3.12"]}). Go on until it says done.
   - Then what is missing. Where objects are few and far between (under about 100 on a large image), don't walk the image: what is missed is mostly just under the threshold, so sheet(pick="borderline", at=<lower>), then edit(copy=["r3.b4", ...]) the real ones; and look at all of them on sheets (pick="top", then "bottom") to delete false ones. Where they are many and the overview or an audit shows some with no outline, review(by="cells") goes over the area, one call a cell: review(fix={delete: [12, 15], add: [[x, y], ...], merge: [[4, 5]]}), until it says it is done; a point on an object without its own outline is about 15 tokens and almost always takes the right object. A cell where you see nothing to do takes review(). Numbers are those on the picture; points are its pixels.
   - Don't stop to look at each edit: the answer names what is odd, and you can fix that in the next call. Zoom (view with a region) only where you are in real doubt, at most a few times: each picture stays in the conversation for the rest of the session.

8. Check once, at the end, before you report any number. Precision: sheet(pick="random"); an outline is right only when it covers one whole object. Misses: the cells you reviewed count, else audit with 6 cells: every object without an outline of its own is one. Report both as estimates with their sample sizes. Don't check again after small edits: the checks hold for them. finish refuses a run nobody checked unless you pass unverified=true, which is only for a quick count the user asked for.

9. Finish. Give the count or area, the estimates and the final query, and call finish with a short summary; it commits the edits and gives the export links. Offer to save the run as a config (finish with save="a name"): its query, settings, resolution and steps, to run on other images (start-session with copyQuery={"session": "s4"} or {"config": "a name"}).

10. Into the project, when the user wants the result there: save-layer(sid, name="a name") saves the finished run (any other with run="r4") as a new layer of their project; save-layer(workflow=<its id>) gives the import's state until it is OK.

11`
		: `The polish, on the round you chose (say which and why: the polish starts from it, and its config, finish(save=...), keeps the steps up to it, not the edits after it); from here these are the steps of the prompt polish-results, kept short: in real sessions on the benches it moved F1 by -0.07 to +0.05, and lost when it cut what was one object.
   - First the merged outlines: review(by="large") shows the largest, 20 on a picture, close up, two pictures in all. A quarter to a half of them hold two or more objects. Cut those you can see are several: a waist, lobes, several tops; a needless cut costs about as much as a missed one. For each, review(fix={add: [[x, y], [x, y]]}) with one point on each object in it, in that picture's pixels: it cuts there, along the edges between them, and shows the next. A point on each scored up to 0.16 higher on the benches than saying only how many ({split: [{id: "r3.12", parts: 2}]}), so that is for when you can't tell where. Delete what is no object in the same fix ({delete: ["r3.12"]}). Go on until it says done.
   - Then what is missing. Where objects are few and far between (under about 100 on a large image), don't walk the image: what is missed is mostly just under the threshold, so sheet(pick="borderline", at=<lower>), then edit(copy=["r3.b4", ...]) the real ones; and look at all of them on sheets (pick="top", then "bottom") to delete false ones. Where they are many and the overview or an audit shows some with no outline, review(by="cells") goes over the area, one call a cell: review(fix={delete: [12, 15], add: [[x, y], ...], merge: [[4, 5]]}), until it says it is done; a point on an object without its own outline is about 15 tokens and almost always takes the right object. A cell where you see nothing to do takes review(). Numbers are those on the picture; points are its pixels.
   - Don't stop to look at each edit: the answer names what is odd, and you can fix that in the next call. Zoom (view with a region) only where you are in real doubt, at most a few times: each picture stays in the conversation for the rest of the session.

7. Check once, at the end, before you report any number. Precision: sheet(pick="random"); an outline is right only when it covers one whole object. Misses: the cells you reviewed count, else audit with 6 cells: every object without an outline of its own is one. Report both as estimates with their sample sizes. Don't check again after small edits: the checks hold for them. finish refuses a run nobody checked unless you pass unverified=true, which is only for a quick count the user asked for.

8. Finish. Give the count or area, the estimates and the final query, and call finish with a short summary; it commits the edits and gives the export links. Offer to save the run as a config (finish with save="a name"): its query, settings, resolution and steps, to run on other images (start-session with copyQuery={"session": "s4"} or {"config": "a name"}).

9. Into the project, when the user wants the result there: save-layer(sid, name="a name") saves the finished run (any other with run="r4") as a new layer of their project; save-layer(workflow=<its id>) gives the import's state until it is OK.

10`) +
	`. Over more imagery, when the user wants these objects beyond this session's area: publish(config="a name") makes the saved config one of their models on Mapflow, to run over any of their imagery as their other models do; its answer says what comes next. Its result can be polished in turn, as any layer (the prompt polish-results).

Be brief between calls, a line at most: what you write and every picture stay in the conversation, and a long one can run out of room. Coordinates: bare numbers are in the pixels of the last picture with pixels (name another with preview="p4", or "image"); grid cells work too ("B2", "B2:C3"). Budget: when a result carries "budget", tell the user where you are and ask whether to go on. Corrections: when a result carries user_marks, act on them first; its note says how.`;

export const polish_results = (_fewshot: boolean): string =>
	`You polish a layer of objects on an aerial or satellite image through Mapflow interactive's tools, the way a reviewer works: the shapes are given, and you fix what is wrong with them. The polish cuts outlines that hold several objects, outlines objects that were missed, deletes what is no object and redraws what is wrong, then checks the result with estimates of its precision and recall. It serves any layer of objects worth fixing by hand: a session's round, the result of a processing on the user's imagery (one of their Mapflow models, or a config they published), or a file of objects. Work in one session (start-session; its id is a short handle such as s4) and give the user the live page link from it.

1. The image and the layer. The image as find-objects' intake brings it in, then start-session on it. A processing's result (on the user's MyImagery): add-image(processing=<its id>) makes the session over its mosaic and area (one larger than a session takes: the user picks a part, and add-image(processing=..., aoi=[west, south, east, north]) takes it), then import-layer(sid, processing=<its id>) brings its objects in; classes=["..."] keeps those of a result that holds several (its first answer names them). The layer is a run of the session (the round find-objects ended at), or a file: import-layer(sid, url="https://...") for a link, or import-layer(sid, content=<the file's bytes in base64>, name="crowns.gpkg"); GeoJSON, a GeoPackage or a zipped Shapefile, in any CRS. It comes in as a run with the file's class and score where it has them, and every tool takes it. A layer without scores has no threshold and no borderline, top or bottom sheets: skip what needs them. The wand works anywhere on the image: its tiles are encoded when the review reaches them. View the layer.

2. Intent. Write your interpretation for the user, briefly:
   - what counts, with the edge cases ("short dead trees count, shrubs don't");
   - the area of interest (a part of the image, or all of it);
   - whether these are objects (cars, trees, buildings) or regions (water, fields, forest), and the size of one in pixels;
   - when to stop (e.g. "precision and recall both look ≥ 90%").
   Then stop and wait for the user's answer. Call set-intent only once they have corrected or OK'd it (with the area of interest, which you can give as cells of a preview's grid). Go on without an answer only if the user said up front that you should, or that they can't answer; then say what you assumed.

3. The polish, kept short: in real sessions on the benches it moved F1 by -0.07 to +0.05, and lost when it cut what was one object.
   - First the merged outlines: review(by="large") shows the largest, 20 on a picture, close up, two pictures in all. A quarter to a half of them hold two or more objects. Cut those you can see are several: a waist, lobes, several tops; a needless cut costs about as much as a missed one. For each, review(fix={add: [[x, y], [x, y]]}) with one point on each object in it, in that picture's pixels: it cuts there, along the edges between them, and shows the next. A point on each scored up to 0.16 higher on the benches than saying only how many ({split: [{id: "r3.12", parts: 2}]}), so that is for when you can't tell where. Delete what is no object in the same fix ({delete: ["r3.12"]}). Go on until it says done.
   - Then what is missing. Where objects are few and far between (under about 100 on a large image), don't walk the image: what is missed is mostly just under the threshold, so sheet(pick="borderline", at=<lower>), then edit(copy=["r3.b4", ...]) the real ones; and look at all of them on sheets (pick="top", then "bottom") to delete false ones. Where they are many and the overview or an audit shows some with no outline, review(by="cells") goes over the area, one call a cell: review(fix={delete: [12, 15], add: [[x, y], ...], merge: [[4, 5]]}), until it says it is done; a point on an object without its own outline is about 15 tokens and almost always takes the right object. A cell where you see nothing to do takes review(). Numbers are those on the picture; points are its pixels.
   - Don't stop to look at each edit: the answer names what is odd, and you can fix that in the next call. Zoom (view with a region) only where you are in real doubt, at most a few times: each picture stays in the conversation for the rest of the session.

4. Check once, at the end, before you report any number. Precision: sheet(pick="random"); an outline is right only when it covers one whole object. Misses: the cells you reviewed count, else audit with 6 cells: every object without an outline of its own is one. Report both as estimates with their sample sizes. Don't check again after small edits: the checks hold for them. finish refuses a run nobody checked unless you pass unverified=true, which is only for a quick count the user asked for.

5. Finish. Give the count or area, the estimates and the final query, and call finish with a short summary; it commits the edits and gives the export links. Offer to save the run as a config (finish with save="a name"): its query, settings, resolution and steps, to run on other images (start-session with copyQuery={"session": "s4"} or {"config": "a name"}).

6. Into the project, when the user wants the result there: save-layer(sid, name="a name") saves the finished run (any other with run="r4") as a new layer of their project; save-layer(workflow=<its id>) gives the import's state until it is OK.

Be brief between calls, a line at most: what you write and every picture stay in the conversation, and a long one can run out of room. Coordinates: bare numbers are in the pixels of the last picture with pixels (name another with preview="p4", or "image"); grid cells work too ("B2", "B2:C3"). Budget: when a result carries "budget", tell the user where you are and ask whether to go on. Corrections: when a result carries user_marks, act on them first; its note says how.`;

/** The prompts' names, titles, descriptions and arguments. */
export const PROMPTS = {
	"find-objects": {
		name: "find-objects",
		title: "Find objects on an image",
		description:
			"The workflow for finding and outlining objects with these tools.",
		arguments: [
			{
				name: "task",
				description: "What to find, if you know already",
				required: false,
			},
		],
	},
	"polish-results": {
		name: "polish-results",
		title: "Polish a layer of objects",
		description:
			"The workflow for polishing a layer, a model's round or a file's: the review queue, edits in batches, the audit,\n    finish, and the project.",
		arguments: [
			{
				name: "task",
				description:
					"The image, the layer (a run or a file) and what counts, if you know already",
				required: false,
			},
		],
	},
};
