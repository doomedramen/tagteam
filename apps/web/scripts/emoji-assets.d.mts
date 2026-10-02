export interface AssetFile {
	path: string;
	sha256: string;
	bytes: number;
}

export interface EmojiAssetManifest {
	model: { id: string; revision: string; files: AssetFile[] };
	runtime: {
		transformers: string;
		onnxruntimeWeb: string;
		files: AssetFile[];
	};
}

export interface FetchOptions {
	fetchImpl?: (url: string) => Promise<Response>;
	attempts?: number;
	retryDelayMs?: number;
}

export interface FetchResult {
	version: string;
	dir: string;
	downloaded: string[];
	kept: string[];
	copied: string[];
	pruned: string[];
}

export const MANIFEST_PATH: string;
export const ASSETS_ROOT: string;
export const WEB_ROOT: string;
export function loadManifest(path?: string): EmojiAssetManifest;
export function assetVersion(manifest: EmojiAssetManifest): string;
export function modelFilesDigest(manifest: EmojiAssetManifest): string;
export function downloadBytes(manifest: EmojiAssetManifest): number;
export function modelUrl(
	manifest: Pick<EmojiAssetManifest, "model">,
	file: AssetFile,
): string;
export function sha256Of(bytes: Uint8Array): string;
export function checkFile(
	path: string,
	entry: AssetFile,
): "ok" | "missing" | "bad";
export function download(url: string, options?: FetchOptions): Promise<Buffer>;
export function currentRevision(
	modelId: string,
	fetchImpl?: (url: string) => Promise<Response>,
): Promise<string>;
export function findOrtDist(webRoot?: string): string;
export function installedTransformersVersion(webRoot?: string): string;
export function fetchEmojiAssets(
	options: FetchOptions & {
		manifest: EmojiAssetManifest;
		root?: string;
		ortDist: string;
		transformersVersion: string;
		log?: (message: string) => void;
	},
): Promise<FetchResult>;
export function buildManifest(
	options: FetchOptions & {
		manifest: EmojiAssetManifest;
		revision: string;
		ortDist: string;
		transformersVersion: string;
		ortVersion: string;
	},
): Promise<EmojiAssetManifest>;
