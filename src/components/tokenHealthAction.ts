import OBR, { isImage, type ContextMenuItem, type Item, type Tool, type ToolMode, type Vector2 } from "@owlbear-rodeo/sdk";
import { toCombatant, type Combatant } from "../encounter/combatant";
import { getPluginId } from "../getPluginId";
import { META_KEY } from "./metadata";

export const HEALTH_POPOVER_ID = getPluginId("token-health");
const HEALTH_TOOL_ID = getPluginId("token-health-tool");
const HEALTH_MODE_ID = getPluginId("token-health-target");

/** Only selected character/mount tokens already in initiative can be edited here. */
export function healthMenuTargets(items: Item[]): Combatant[] {
    return items.filter((item) => isImage(item) && (item.layer === "CHARACTER" || item.layer === "MOUNT"))
        .map(toCombatant).filter((combatant): combatant is Combatant => combatant !== null);
}

async function openTokenHealth(items: Item[], position?: Vector2) {
    if (await OBR.player.getRole() !== "GM") return;
    const targets = healthMenuTargets(items);
    if (!targets.length || targets.length !== items.length) {
        await OBR.notification.show("Select one or more tokens already in initiative.", "INFO");
        return;
    }
    const params = new URLSearchParams();
    for (const target of targets) params.append("token", target.id);
    const [point, width, height] = await Promise.all([
        OBR.viewport.transformPoint(position ?? items[0].position), OBR.viewport.getWidth(), OBR.viewport.getHeight(),
    ]);
    // The overflow-menu button disappears after a click; anchor to screen coordinates instead.
    await OBR.popover.open({
        id: HEALTH_POPOVER_ID, url: `/health.html?${params}`, width: 260, height: 112,
        anchorReference: "POSITION",
        anchorPosition: {
            left: Math.max(16, Math.min(point.x + 16, width - 260 - 16)),
            top: Math.max(16, Math.min(point.y + 16, height - 112 - 16)),
        },
        transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    });
}

async function showOpenError(error: unknown) {
    console.error("[Battle Board] Could not open token health controls:", error);
    await OBR.notification.show("Could not open health controls. Reload Battle Board and try again.", "ERROR").catch(console.error);
}

export function tokenHealthContextMenu(): ContextMenuItem {
    return {
        id: getPluginId("token-health-menu"),
        icons: [{
            icon: "/health.svg",
            label: "Damage / Heal",
            filter: {
                roles: ["GM"], permissions: ["UPDATE"],
                every: [
                    { key: "layer", value: "CHARACTER", coordinator: "||" },
                    { key: "layer", value: "MOUNT" },
                    { key: "type", value: "IMAGE" },
                    { key: ["metadata", META_KEY], value: undefined, operator: "!=" },
                    { key: ["metadata", META_KEY, "inInitiative"], value: false, operator: "!=" },
                ],
            },
        }],
        async onClick(context) {
            try {
                await openTokenHealth(context.items, { x: context.selectionBounds.center.x, y: context.selectionBounds.max.y });
            } catch (error) {
                await showOpenError(error);
            }
        },
    };
}

/** Open a surviving selection immediately, otherwise activate click-to-target mode. */
export function tokenHealthTool(): Tool {
    return {
        id: HEALTH_TOOL_ID,
        defaultMode: HEALTH_MODE_ID,
        icons: [{ icon: "/health.svg", label: "Damage / Heal — click a token", filter: { roles: ["GM"] } }],
        async onClick() {
            try {
                // Ask for selection immediately, before awaiting another SDK request.
                const [ids, role] = await Promise.all([OBR.player.getSelection(), OBR.player.getRole()]);
                if (role !== "GM") return false;
                if (ids?.length) {
                    const items = await OBR.scene.items.getItems(ids);
                    if (items.length === ids.length && healthMenuTargets(items).length === ids.length) {
                        await openTokenHealth(items);
                        return false;
                    }
                }
                // Toolbar interaction can clear the selection. Let the user explicitly
                // click a target rather than guessing from a previously selected token.
                return true;
            } catch (error) {
                await showOpenError(error);
            }
            return false;
        },
    };
}

/** Pointer events carry the clicked token directly, without relying on player selection. */
export function tokenHealthMode(): ToolMode {
    return {
        id: HEALTH_MODE_ID,
        icons: [{ icon: "/health.svg", label: "Click a token to damage or heal", filter: { activeTools: [HEALTH_TOOL_ID], roles: ["GM"] } }],
        cursors: [{ cursor: "crosshair" }],
        async onToolClick(_context, event) {
            if (!event.target) return false;
            try {
                if (await OBR.player.getRole() !== "GM") return false;
                // Read fresh token data; no selection API is involved in targeting.
                const items = await OBR.scene.items.getItems([event.target.id]);
                await openTokenHealth(items);
            } catch (error) {
                await showOpenError(error);
            }
            return false;
        },
    };
}

// SDK remove() deletes its local handler after awaiting the host's reply. Serialize
// registration and cleanup so a StrictMode remount cannot lose its new handler.
let registrations = Promise.resolve();
function enqueueRegistration(operation: () => Promise<void>) {
    registrations = registrations.then(operation).catch((error) => console.error("[Battle Board] Health action registration failed:", error));
}

export function registerTokenHealthActions(): () => void {
    const menu = tokenHealthContextMenu();
    const tool = tokenHealthTool();
    const mode = tokenHealthMode();
    enqueueRegistration(async () => {
        await OBR.contextMenu.create(menu);
        await OBR.tool.create(tool);
        await OBR.tool.createMode(mode);
    });
    return () => enqueueRegistration(async () => {
        await OBR.contextMenu.remove(menu.id);
        await OBR.tool.removeMode(mode.id);
        await OBR.tool.remove(tool.id);
    });
}
