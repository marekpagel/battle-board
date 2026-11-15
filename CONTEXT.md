# Battle Board

An Owlbear Rodeo extension for running combat encounters: initiative order, turns and rounds, health, range rings, elevation and distances between tokens on the map.

## Language

### Encounter

**Encounter**:
The combat currently being run in a scene: whether it has started, the current round, and which combatants take part.
_Avoid_: Combat, fight, battle

**Round**:
One full pass through the turn order; increments when the order wraps from last to first.

**Combatant**:
A token taking part in the encounter, i.e. listed in initiative.
_Avoid_: Creature, entry, row, initiative item

**Token**:
The map item underneath a combatant. It keeps its data (stats, group membership) whether or not it is currently a combatant.

**Remove**:
Take a combatant out of the initiative list. Its token keeps all its data, so adding it again restores it exactly.

**Clear all**:
Remove every combatant at once.

**Turn**:
One slot in the turn order, taken by either a single combatant or a whole group.

**Active**:
Whose turn it currently is. Exactly one turn is active while the encounter has started.
_Avoid_: Current, selected

**Initiative**:
The number that places a turn in the turn order; higher goes first.

**Initiative bonus**:
The modifier added to a d20 initiative roll. Each token keeps its individual bonus; a group has a separate shared bonus and rolls once for all members. Bonuses default to 0. Bulk rolls apply only to NPC turns. A PC at 0 initiative can be explicitly rolled before the encounter starts; a grouped PC rolls once for the group using its shared bonus. Players must own every group member to roll it themselves; otherwise the DM rolls the group. The DM can reset all initiatives to 0 before an encounter, including staged groups, without changing bonuses or member order.

**Character profile**:
Reusable permanent stats saved in the room under a token's name: max HP, speed, AC, individual initiative bonus and PC/NPC flag. Name matching ignores case and surrounding spaces. Fresh tokens load a matching profile when first added to initiative and start at full HP; returning tokens keep their saved stats. The DM can explicitly Save, Update, Load or Forget a profile from expanded combatant options. Settings lists saved profiles and supports deleting them, copying JSON, and importing JSON by merging names or replacing the collection. Profiles do not contain encounter state or update existing combatants automatically.

### Groups

**Group**:
Several combatants that share one turn and one initiative. Grouping affects only turn order: each member is still its own token on the map, with its own distances, rings and elevation. A group exists only as a property of its member tokens.
_Avoid_: Encounter group, encounters (legacy names)

**Member order**:
The fixed order of members within a group, shown as the group's initiative followed by the member's position (15, 15.1, … 15.9, 15.10, 15.11). A member added later goes last.

**Staged**:
A group listed separately and excluded from the turn order until released, optionally with its members hidden on the map.

**Ungroup**:
Dissolve a group so each member takes its own turn.

### Combatants

**PC**:
A combatant controlled by a player. Determines turn rings, which health visibility rule applies, and whether players may edit its HP. PCs always appear in the player tracker, including before an encounter starts and when the general player list is disabled. Players may enter PC initiative only while the encounter has not started; during the encounter it is read-only.
_Avoid_: Player character flag, hero

**NPC**:
Any combatant that is not a PC.
_Avoid_: Monster, enemy

**Max HP edit**:
Changing max HP also sets current HP to that maximum, before or during an encounter. It leaves temp HP unchanged and counts as a stat correction rather than damage.

**Bloodied**:
Health status of a combatant below half its max HP.

**Dying** / **Dead**:
Health status at 0 HP: Dying for a PC, Dead for an NPC.

**Health mode**:
What players may see of a combatant's health: none, status only, or numbers. Set separately for PCs and NPCs.

**Concentration check**:
A prompt raised when a concentrating combatant takes damage, with DC equal to the greater of 10 and half the damage. Shown to the GM always, and to players only for PCs.

**Owner**:
The player who owns a token: Owlbear's `createdUserId`, which the GM can reassign in Owlbear. A combatant owned by the GM has no owner in this sense.

### Turn bar

**Turn bar**:
A player's floating tracker, shown during an encounter when the room setting is on and they own a visible combatant in the turn order. One slide per owned combatant, never per group.
_Avoid_: Action bar

**Turn resources**:
What a combatant has used of its turn: action, bonus action and reaction. They reset when the combatant's turn starts, including as part of a group turn or by stepping back with Previous. Off-turn only the reaction can be marked used. Starting or ending the encounter, or joining initiative, clears them.

**End turn**:
A combatant saying it has finished. The turn advances once every counted member has ended: members that are visible and owned by a connected player. A turn with no counted members is driven by the GM as before; the GM's controls always work.

### Map

**Elevation**:
The height of a token's bottom face above the map, in scene units; may be negative.

**Movement ring**:
A circle around a combatant showing how far it can move this turn.

**Map health bar**:
A compact overlay below each token with saved health data, including tokens outside initiative. The GM sees an HP bar, current/max HP, and temp HP. Players see their configured PC/NPC health mode, with no overlays when the master health switch is off. Bars are local to each viewer, update while the tracker is open, and disappear when it closes.

**DM preview**:
A ring visible only to the GM, toggled per combatant, independent of whose turn it is.
