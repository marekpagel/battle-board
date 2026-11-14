---
status: accepted
---

# Map health bars are local to each viewer

A GM always sees full health bars and HP numbers. Players see only the health
mode configured for PCs and NPCs, behind the existing master health switch.
One shared scene item cannot represent these different views. Health bars use
`OBR.scene.local` and are rebuilt from saved token health and room settings on
each client. Local overlays contain only the data permitted for that viewer.
They are temporary and are removed when the tracker unmounts.

This extends ADR-0003: its GM-only writer rule continues to apply to shared
scene items (rings and elevation labels). Players may write
their own local health bars because those items never reach another client or
persist in the scene. Local and shared item ports are separate so the boundary
can be exercised in tests.

Tokens without saved health data get no overlay. Hidden tokens have overlays
only on GM clients. Tokens retain their health overlays after removal from
initiative because their saved stats remain on the token (ADR-0001).
