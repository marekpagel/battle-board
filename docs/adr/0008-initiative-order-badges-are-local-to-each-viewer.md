# Initiative order badges follow each viewer's visible turns

Badges show ordinal turn positions, starting at 1, while an encounter runs.
Members of a group share a position because they share a turn. Staged groups
are outside the turn order and receive no badge.

Like map health bars (ADR-0006), badges use local scene items. GMs see the full
turn order. Players see badges on every visible combatant regardless of
ownership or the player initiative-list setting. Hidden tokens are excluded,
and visible turns are renumbered without gaps. Shared badges would expose
hidden turns through their numbers or gaps in numbering.

Each client derives badges from token metadata and the encounter clock
without writing saved data. This extends ADR-0003's local-overlay
exception in ADR-0006; GM-only writers still handle shared derived scene items.
Local badges disappear when the encounter ends or the tracker unmounts.
