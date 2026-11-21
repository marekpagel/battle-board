import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OBR, { type ContextMenuContext, type Item, type ToolEvent } from "@owlbear-rodeo/sdk";
import ContextMenuApi from "@owlbear-rodeo/sdk/lib/api/ContextMenuApi";
import { DEFAULT_META, META_KEY } from "./metadata";
import { makeToken } from "../test/tokens";
import { flush } from "../obr/fakeScene";
import { HEALTH_POPOVER_ID, healthMenuTargets, registerTokenHealthActions, tokenHealthContextMenu, tokenHealthMode, tokenHealthTool } from "./tokenHealthAction";

const tracked = (id: string) => makeToken({ id, metadata: { [META_KEY]: { ...DEFAULT_META, name: id, visible: true } } });
const context = (items: ContextMenuContext["items"]): ContextMenuContext => ({
    items,
    selectionBounds: { min: { x: 0, y: 0 }, max: { x: 100, y: 100 }, center: { x: 50, y: 50 }, width: 100, height: 100 },
});
const pointer = (target?: Item): ToolEvent => ({ target, pointerPosition: { x: 0, y: 0 }, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false });

beforeEach(() => {
    vi.spyOn(OBR.player, "getRole").mockResolvedValue("GM");
    vi.spyOn(OBR.popover, "open").mockResolvedValue(undefined);
    vi.spyOn(OBR.notification, "show").mockResolvedValue("notification");
    vi.spyOn(OBR.viewport, "transformPoint").mockResolvedValue({ x: 250, y: 300 });
    vi.spyOn(OBR.viewport, "getWidth").mockResolvedValue(1200);
    vi.spyOn(OBR.viewport, "getHeight").mockResolvedValue(900);
    vi.spyOn(OBR.player, "getSelection").mockResolvedValue(["zombie"]);
    vi.spyOn(OBR.scene.items, "getItems").mockResolvedValue([tracked("zombie")]);
    vi.spyOn(OBR.tool, "createMode").mockResolvedValue(undefined);
    vi.spyOn(OBR.tool, "removeMode").mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("token health action", () => {
    it("offers an update action only to the DM for tokens already in initiative", () => {
        const menu = tokenHealthContextMenu();
        expect(menu.icons[0]).toMatchObject({ label: "Damage / Heal", filter: { roles: ["GM"], permissions: ["UPDATE"] } });
        expect(menu.icons[0].filter?.every).toContainEqual({ key: ["metadata", META_KEY, "inInitiative"], value: false, operator: "!=" });
        const removed = tracked("removed");
        Object.assign(removed.metadata[META_KEY] as object, { inInitiative: false });
        const map = tracked("map");
        map.layer = "MAP";
        const mount = tracked("mount");
        mount.layer = "MOUNT";
        expect(healthMenuTargets([tracked("zombie"), mount, map, removed, makeToken({ id: "untracked" })]).map((c) => c.id))
            .toEqual(["zombie", "mount"]);
    });

    it("pins selected token ids and opens beside the tokens without depending on a disappearing menu button", async () => {
        const menu = tokenHealthContextMenu();
        await menu.onClick!(context([tracked("zombie one"), tracked("zombie&two")]), "health-button");
        expect(OBR.popover.open).toHaveBeenCalledOnce();
        const [popover] = vi.mocked(OBR.popover.open).mock.calls[0];
        expect(popover).toMatchObject({ id: HEALTH_POPOVER_ID, anchorReference: "POSITION", anchorPosition: { left: 266, top: 316 } });
        expect(popover).not.toHaveProperty("anchorElementId");
        expect(OBR.viewport.transformPoint).toHaveBeenCalledWith({ x: 50, y: 100 });
        expect(new URL(popover.url, "https://extension.test").searchParams.getAll("token")).toEqual(["zombie one", "zombie&two"]);
    });

    it("does not open controls for players, even when the callback is called directly", async () => {
        vi.mocked(OBR.player.getRole).mockResolvedValue("PLAYER");
        await tokenHealthContextMenu().onClick!(context([tracked("zombie")]), "health-button");
        await tokenHealthTool().onClick!({ activeTool: "move", metadata: {} }, "health-tool");
        expect(OBR.popover.open).not.toHaveBeenCalled();
    });

    it("does not silently turn a mixed or empty selection into a different set of targets", async () => {
        const menu = tokenHealthContextMenu();
        await menu.onClick!(context([tracked("zombie"), makeToken({ id: "untracked" })]), "health-button");
        await menu.onClick!(context([]), "health-button");
        expect(OBR.popover.open).not.toHaveBeenCalled();
        expect(OBR.notification.show).toHaveBeenCalledWith("Select one or more tokens already in initiative.", "INFO");
    });

    it("keeps the popup inside the viewport when the token is near an edge", async () => {
        vi.mocked(OBR.viewport.transformPoint).mockResolvedValue({ x: 1190, y: 890 });
        await tokenHealthContextMenu().onClick!(context([tracked("zombie")]), "menu");
        expect(OBR.popover.open).toHaveBeenCalledWith(expect.objectContaining({ anchorPosition: { left: 924, top: 772 } }));
    });

    it("provides a GM toolbar button that uses the current selection without switching the active tool", async () => {
        const tool = tokenHealthTool();
        expect(tool.icons[0].filter?.roles).toEqual(["GM"]);
        const result = await tool.onClick!({ activeTool: "move", metadata: {} }, "toolbar-heart");
        expect(result).toBe(false);
        expect(OBR.scene.items.getItems).toHaveBeenCalledWith(["zombie"]);
        const [popover] = vi.mocked(OBR.popover.open).mock.calls[0];
        expect(new URL(popover.url, "https://extension.test").searchParams.getAll("token")).toEqual(["zombie"]);
    });

    it("activates targeting when toolbar interaction has cleared the selection, then opens the clicked token", async () => {
        vi.mocked(OBR.player.getSelection).mockResolvedValue(undefined);
        const tool = tokenHealthTool();
        expect(tool.defaultMode).toBe(tokenHealthMode().id);
        expect(await tool.onClick!({ activeTool: "move", metadata: {} }, "toolbar-heart")).toBe(true);
        expect(OBR.popover.open).not.toHaveBeenCalled();
        expect(OBR.notification.show).not.toHaveBeenCalled();

        await tokenHealthMode().onToolClick!({ activeTool: tool.id, metadata: {} }, pointer(tracked("zombie")));
        expect(OBR.scene.items.getItems).toHaveBeenCalledWith(["zombie"]);
        const [popover] = vi.mocked(OBR.popover.open).mock.calls[0];
        expect(new URL(popover.url, "https://extension.test").searchParams.getAll("token")).toEqual(["zombie"]);
    });

    it("targets the clicked token independently of any stale selection", async () => {
        vi.mocked(OBR.player.getSelection).mockResolvedValue(["old-selection"]);
        vi.mocked(OBR.scene.items.getItems).mockResolvedValue([tracked("new-target")]);
        await tokenHealthMode().onToolClick!({ activeTool: "health", metadata: {} }, pointer(tracked("new-target")));
        expect(OBR.player.getSelection).not.toHaveBeenCalled();
        const [popover] = vi.mocked(OBR.popover.open).mock.calls[0];
        expect(new URL(popover.url, "https://extension.test").searchParams.getAll("token")).toEqual(["new-target"]);
    });

    it("ignores empty map clicks and blocks targeting for players", async () => {
        const mode = tokenHealthMode();
        await mode.onToolClick!({ activeTool: "health", metadata: {} }, pointer());
        vi.mocked(OBR.player.getRole).mockResolvedValue("PLAYER");
        await mode.onToolClick!({ activeTool: "health", metadata: {} }, pointer(tracked("zombie")));
        expect(OBR.popover.open).not.toHaveBeenCalled();
        expect(OBR.scene.items.getItems).not.toHaveBeenCalled();
    });

    it("starts reading the selection before waiting for the role request", async () => {
        let finishRole: (role: "GM" | "PLAYER") => void = () => {};
        vi.mocked(OBR.player.getRole).mockReturnValue(new Promise((resolve) => { finishRole = resolve; }));
        const click = tokenHealthTool().onClick!({ activeTool: "move", metadata: {} }, "heart");
        expect(OBR.player.getSelection).toHaveBeenCalledOnce();
        finishRole("GM");
        await click;
        expect(OBR.popover.open).toHaveBeenCalledOnce();
    });

    it("reports popup failures instead of leaving the action silent", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(OBR.popover.open).mockRejectedValue(new Error("failed to open"));
        await tokenHealthContextMenu().onClick!(context([tracked("zombie")]), "menu");
        expect(OBR.notification.show).toHaveBeenCalledWith(expect.stringContaining("Could not open health controls"), "ERROR");
    });

    it("preserves the real SDK click handler across a StrictMode remount with a delayed removal reply", async () => {
        type Click = { id: string; context: ContextMenuContext; elementId: string };
        let click: ((event: Click) => void) | undefined;
        let releaseRemoval = () => {};
        let delayRemoval = true;
        const bus = {
            on(_event: string, handler: (event: Click) => void) { click = handler; },
            sendAsync(event: string) {
                if (event === "OBR_CONTEXT_MENU_REMOVE" && delayRemoval) {
                    delayRemoval = false;
                    return new Promise<void>((resolve) => { releaseRemoval = resolve; });
                }
                return Promise.resolve();
            },
        };
        const api = new ContextMenuApi(bus as unknown as ConstructorParameters<typeof ContextMenuApi>[0]);
        const create = vi.spyOn(OBR.contextMenu, "create").mockImplementation((menu) => api.create(menu));
        vi.spyOn(OBR.contextMenu, "remove").mockImplementation((id) => api.remove(id));
        vi.spyOn(OBR.tool, "create").mockResolvedValue(undefined);
        vi.spyOn(OBR.tool, "remove").mockResolvedValue(undefined);

        const stopFirst = registerTokenHealthActions();
        stopFirst();
        const stopSecond = registerTokenHealthActions();
        await flush();
        expect(create).toHaveBeenCalledTimes(1); // Replacement waits for the old SDK remove() to finish.
        releaseRemoval();
        await flush();
        expect(create).toHaveBeenCalledTimes(2);
        click!({ id: tokenHealthContextMenu().id, context: context([tracked("zombie")]), elementId: "menu" });
        await flush();
        expect(OBR.popover.open).toHaveBeenCalledOnce();
        stopSecond();
        await flush();
    });
});
