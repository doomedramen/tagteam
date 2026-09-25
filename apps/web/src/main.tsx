import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
	void import("@serwist/window").then(({ Serwist }) =>
		new Serwist("/sw.js", { type: "classic" }).register(),
	);
}
