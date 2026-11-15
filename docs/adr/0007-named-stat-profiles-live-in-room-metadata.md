---
status: accepted
---

# Named stat profiles live in room metadata

Reusable character profiles are stored under
`com.missing-link-dev.battle-board/characterProfiles` in room metadata, keyed
by the token's displayed name after trimming surrounding spaces and converting
to lowercase. A single profile can initialize any number of PCs or NPCs across
scenes in that room. Names match in full; numeric suffixes are not stripped.

Profiles contain only max HP, movement speed, AC, individual initiative bonus,
and the PC/NPC flag. Saving is explicit and replaces the profile for that name.
Other stats, current HP, temp HP, initiative rolls, group membership and turn
state are not templates. GM clients can save, load, update and forget profiles.

On first adding a fresh token to initiative, including directly into a group,
the matching profile is copied into its metadata and current HP starts at max.
This extends ADR-0001 with reusable templates rather than a second live source
of combatant state: actual combatants still use their own token metadata.
Already-prepared and returning tokens retain all saved stats and health, in
accordance with the existing Remove behavior. An explicit Load profile action
can replace their permanent stats and refill current HP while preserving the
rest of their state. Updating a profile does not rewrite existing combatants.

Each batch addition reads the profiles once before the token update. Profile
writes read the latest room metadata, preserve other extension keys and saved
profiles, and reject writes that exceed Owlbear's 16 KB total room metadata
limit. The UI reports write failures; tokens are not changed by a failed save.
Profiles stay within the room and require no external storage service.


Settings exposes the saved collection as a table and editable JSON. The exported
JSON is the profile-name map, without other room metadata. Import defaults to
merging normalized names into the latest saved collection, while an explicit
replace mode restores the collection exactly. Malformed profiles, empty names
and normalized-name collisions reject the entire import before any write.
Import uses the same GM permission check and room storage limit as saving an
individual profile, and never applies profiles to existing tokens.
