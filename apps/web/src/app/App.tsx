import { RouterProvider } from "react-router";
import { AppUpdateProvider } from "./AppUpdate";
import { router } from "./router";

export function App() {
	return (
		<AppUpdateProvider>
			<RouterProvider router={router} />
		</AppUpdateProvider>
	);
}
