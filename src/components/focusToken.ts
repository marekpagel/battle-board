import OBR from "@owlbear-rodeo/sdk";
import { toCMToken, type CMToken } from "./tokens";

/**
 * Animate the viewport to center on a token's position in the scene.
 * Preserves the current zoom level.
 */
export async function focusToken(tokenId: string, tokens?: CMToken[]): Promise<void> {
    let token = tokens?.find((t) => t.id === tokenId);
    if (!tokens) {
        const [item] = await OBR.scene.items.getItems([tokenId]);
        token = item ? toCMToken(item) ?? undefined : undefined;
    }
    if (!token) return;

    const [scale, width, height] = await Promise.all([
        OBR.viewport.getScale(),
        OBR.viewport.getWidth(),
        OBR.viewport.getHeight(),
    ]);

    const position = {
        x: -token.center.x * scale + width / 2,
        y: -token.center.y * scale + height / 2,
    };

    await OBR.viewport.animateTo({ position, scale });

    await OBR.broadcast.sendMessage(
        "com.missing-link-dev.battle-board/selected",
        tokenId,
        { destination: "LOCAL" },
    );
}
