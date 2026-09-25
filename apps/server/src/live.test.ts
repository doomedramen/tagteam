import { expect, it } from "vitest";
import { createLiveHub } from "./live";

it("pokes subscribers of the given users until they unsubscribe", () => {
	const hub = createLiveHub();
	const seen: string[] = [];
	const stopA = hub.subscribe("a", () => seen.push("a1"));
	hub.subscribe("a", () => seen.push("a2"));
	hub.subscribe("b", () => seen.push("b"));

	hub.pokeUsers(["a"]);
	expect(seen).toEqual(["a1", "a2"]);

	stopA();
	hub.pokeUsers(["a", "b", "nobody"]);
	expect(seen).toEqual(["a1", "a2", "a2", "b"]);
});
