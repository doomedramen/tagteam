import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	ASSETS_ROOT,
	assetVersion,
	loadManifest,
} from "../scripts/emoji-assets.mjs";

/** True when the model files from `emoji:assets` are in public/, so the build served them. */
export function emojiModelPresent(): boolean {
	const manifest = loadManifest();
	return existsSync(
		join(
			ASSETS_ROOT,
			assetVersion(manifest),
			"models",
			manifest.model.id,
			"onnx/model_quantized.onnx",
		),
	);
}

/** The asset version this build serves, as `/assets/emoji/<version>/`. */
export const emojiAssetsPath = () =>
	`/assets/emoji/${assetVersion(loadManifest())}/`;

/** The URL path of a file of the model, for example `onnx/model_quantized.onnx`. */
export const emojiModelPath = (file: string) => {
	const manifest = loadManifest();
	return `${emojiAssetsPath()}models/${manifest.model.id}/${file}`;
};
