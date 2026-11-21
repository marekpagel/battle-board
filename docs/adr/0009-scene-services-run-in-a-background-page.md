# Scene services run in a background page

The extension manifest loads `background.html` for each client. While a scene
is ready, this frame owns context menus and tools, turn-bar visibility,
player turn completion, migrations, rings, elevation labels, health bars and
initiative badges. The main panel only renders the tracker and settings.

Closing the main panel must not stop an encounter or its map updates. A single
background owner also avoids duplicate local overlays or popup controllers
when both the panel and turn bar are open. Scene teardown stops these services,
closes the turn bar, and disposes that frame's encounter subscription. Pending
reads from a disposed subscription cannot restore a previous scene's state.

This updates the overlay lifetime described in ADR-0006 and ADR-0008: local
overlays now live while the scene runtime is mounted, rather than while the
tracker panel is mounted. Shared derived items still have GM-only writers
(ADR-0003), and only GM runtimes advance player-completed turns (ADR-0005).

The DM turn bar follows the active turn regardless of ownership or the player
turn-bar setting. It includes hidden combatants, group-member browsing, NPC
resources, previous/next turn, round, ending the encounter and opening the main
panel. Player bars retain their ownership, visibility and room-setting rules.
Each viewer controls the bar's position and visibility locally.
