import { buildLabel, isLabel, type Item, type Label, type Vector2 } from "@owlbear-rodeo/sdk";
import { footprintCells } from "../battlefield/footprint";
import { deriveGroups } from "../encounter/groups";
import { combatantsOf, readClock } from "../encounter/store";
import { turnOrder } from "../encounter/turnOrder";
import { getPluginId } from "../getPluginId";
import type { ObrPort, Role, Unsubscribe } from "../obr/port";

export const INITIATIVE_BADGE_KEY = getPluginId("initiative-badge");
const PREFIX = `${INITIATIVE_BADGE_KEY}.`;

export type InitiativeBadgeSpec = {
    id: string;
    tokenId: string;
    order: number;
    active: boolean;
    position: Vector2;
    size: number;
};

/** Turn positions, shared by group members and numbered only across the viewer's visible turns. */
export function desiredInitiativeBadges(
    items: Item[], scene: Record<string, unknown>, dpi: number, role: Role,
): InitiativeBadgeSpec[] {
    if (!readClock(scene).started) return [];
    const combatants = combatantsOf(items);
    const groups = deriveGroups(combatants);
    const allowed = new Set(combatants.filter((c) => role === "GM" || c.visible).map((c) => c.id));
    const byId = new Map(items.map((item) => [item.id, item]));
    const specs: InitiativeBadgeSpec[] = [];
    let order = 0;
    for (const turn of turnOrder({ combatants, groups })) {
        const ids = turn.ids.filter((id) => allowed.has(id));
        if (!ids.length) continue;
        order++;
        for (const tokenId of ids) {
            const token = byId.get(tokenId)!;
            const cells = footprintCells(token);
            const size = Math.min(32, Math.max(16, dpi * 0.2));
            specs.push({
                id: `${PREFIX}${tokenId}`, tokenId, order, active: turn.active, size,
                position: {
                    x: token.position.x + cells.w * dpi / 2 - size / 2,
                    y: token.position.y - cells.h * dpi / 2 + size / 2,
                },
            });
        }
    }
    return specs;
}

export function buildInitiativeBadge(spec: InitiativeBadgeSpec): Label {
    const text = String(spec.order);
    return buildLabel()
        .id(spec.id).name(`Initiative order: ${text}`).plainText(text)
        .position(spec.position).width(spec.size).height(spec.size).padding(0)
        .fontFamily("Arial").fontSize(Math.min(spec.size * 0.65, spec.size / text.length * 1.3))
        .fontWeight(700).lineHeight(1).textAlign("CENTER").textAlignVertical("MIDDLE")
        .fillColor("#ffffff").fillOpacity(1)
        .backgroundColor(spec.active ? "#6d46a2" : "#202334").backgroundOpacity(0.95)
        .cornerRadius(spec.size / 2).pointerWidth(0).pointerHeight(0)
        .minViewScale(1).maxViewScale(1)
        .attachedTo(spec.tokenId).disableAttachmentBehavior(["SCALE", "ROTATION", "VISIBLE", "COPY"])
        .layer("TEXT").zIndex(1010).disableAutoZIndex(true).locked(true).disableHit(true)
        .metadata({ [INITIATIVE_BADGE_KEY]: JSON.stringify(["v1", spec]) }).build();
}

type BadgeFactory = typeof buildInitiativeBadge;
const queues = new WeakMap<ObrPort, Promise<void>>();
const owners = new WeakMap<ObrPort, symbol>();

/** Serialize local writes, including cleanup followed immediately by a remount. */
function syncBadges(port: ObrPort, specs: InitiativeBadgeSpec[], build: BadgeFactory): Promise<void> {
    const run = (queues.get(port) ?? Promise.resolve()).then(async () => {
        const wanted = new Map(specs.map((spec) => { const item = build(spec); return [item.id, item]; }));
        const existing = (await port.localItems.get()).filter((item) => item.id.startsWith(PREFIX));
        const remove = existing.filter((item) => !wanted.has(item.id) || !isLabel(item)).map((item) => item.id);
        const kept = new Map(existing.filter((item) => !remove.includes(item.id)).map((item) => [item.id, item]));
        const changed = [...wanted.values()].filter((item) => kept.has(item.id) &&
            kept.get(item.id)!.metadata[INITIATIVE_BADGE_KEY] !== item.metadata[INITIATIVE_BADGE_KEY]);
        if (remove.length) await port.localItems.delete(remove);
        if (changed.length) await port.localItems.update(changed.map((item) => item.id), (items) => {
            for (const item of items) {
                const next = wanted.get(item.id)!;
                if (!isLabel(item)) continue;
                item.position = next.position;
                item.text = next.text;
                item.style = next.style;
                item.metadata = next.metadata;
                item.name = next.name;
            }
        });
        const add = [...wanted.values()].filter((item) => !kept.has(item.id));
        if (add.length) await port.localItems.add(add);
    });
    queues.set(port, run.catch(() => {}));
    return run;
}

/** Local overlays respect token visibility and never write token or scene metadata. */
export function startInitiativeBadgeSync(port: ObrPort, build: BadgeFactory = buildInitiativeBadge): Unsubscribe {
    const owner = Symbol("initiative-badges");
    owners.set(port, owner);
    let stopped = false;
    let pending = false;
    let running: Promise<void> | null = null;
    const run = () => {
        pending = true;
        if (running || stopped) return;
        running = (async () => {
            while (pending && !stopped) {
                pending = false;
                const [items, scene, dpi, role] = await Promise.all([
                    port.items.get(), port.sceneMetadata.get(), port.grid.getDpi(), port.player.getRole(),
                ]);
                if (!stopped) await syncBadges(port, desiredInitiativeBadges(items, scene, dpi, role), build);
            }
        })().catch((error) => console.error("[Battle Board] Initiative badge sync failed:", error))
            .finally(() => { running = null; if (pending && !stopped) run(); });
    };
    const unsubscribes = [port.items.onChange(run), port.sceneMetadata.onChange(run), port.grid.onChange(run)];
    run();
    return () => {
        stopped = true;
        unsubscribes.forEach((unsubscribe) => unsubscribe());
        void (async () => {
            await running;
            if (owners.get(port) !== owner) return;
            await syncBadges(port, [], build);
            if (owners.get(port) === owner) owners.delete(port);
        })().catch(console.error);
    };
}
