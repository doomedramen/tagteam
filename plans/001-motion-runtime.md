# 001 — Add shared motion runtime

- **Status**: DONE
- **Commit**: a90b17c
- **Severity**: MEDIUM
- **Category**: Accessibility and cohesion
- **Estimated scope**: 4 files, small

## Problem

The web app uses React 19, Vite, Tailwind, and Base UI. It has one easing token, but no React motion runtime. New enter/exit motion would otherwise duplicate hand-built timing and reduced-motion behavior.

Current root render in apps/web/src/main.tsx:1-11:

~~~tsx
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
~~~

Current easing token in apps/web/src/index.css:23:

~~~css
--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);
~~~

apps/web/package.json has no Motion dependency.

## Target

Add Motion for React presence and layout transitions. Wrap App in MotionConfig with reducedMotion set to user. Keep existing StrictMode and app structure.

Add this shared movement token beside --ease-out-strong:

~~~css
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
~~~

Use --ease-out-strong for elements entering or exiting. Use --ease-in-out for layout movement. Keep UI transitions at or below 300ms, except existing drawer transitions.

## Repo conventions to follow

- Keep web-only dependencies in apps/web/package.json and update pnpm-lock.yaml through pnpm.
- Keep shared motion tokens in apps/web/src/index.css.
- Root setup lives in apps/web/src/main.tsx.
- Import React APIs from motion/react.

## Steps

1. Add the motion package to @tagteam/web with pnpm. Keep the resolved package version in the lockfile.
2. Import MotionConfig from motion/react.
3. Wrap App in MotionConfig with reducedMotion="user" inside StrictMode.
4. Add --ease-in-out beside --ease-out-strong.
5. Keep all animations opt-in at their interaction sites. Do not add page-wide entrance motion.

## Boundaries

- Do not modify feature behavior or visual styling in this plan.
- Do not add a shared animation wrapper component.
- Do not animate initial page load.
- Later plans depend on this plan.

## Verification

- **Mechanical**: Run pnpm --filter @tagteam/web typecheck, pnpm --filter @tagteam/web build, and pnpm lint. Expect all commands to pass.
- **Feel check**: Open a feature from each later plan. With normal motion, confirm motion uses the shared curves. Enable reduced motion and confirm positional movement drops while opacity feedback remains.
- **Done when**: Motion is available from motion/react, MotionConfig wraps App, and both shared easing tokens exist.
