## Design notes — Media browser · 2026-10-01

**The design round is complete.** We used an HTML prototype to agree on the layout, user flows, and product scope. This does not mean issue #11 is implemented.

### 1. Goal and agreed scope

Focus on **find media → preview → select → add to canvas** before adding more advanced features.

- Use **English** for all UI text.
- Open a wide Media browser over the canvas, with enough room to browse files and see their details.
- Accept the larger window because it makes the layout clearer and easier to extend. A mini version can come later.
- Keep team administration, ownership, sharing settings, and advanced project management outside the canvas UI.

### 2. Navigation

The sidebar has two entries: **Spaces** and **Stock media**.

Inside **Spaces**:
- The heading shows the current space. Click it to open the space dropdown.
- The dropdown includes search, **Personal Space**, and the team spaces the user can access.
- Start in the space that contains the canvas. A personal canvas opens Personal Space. A shared canvas opens its team space.
- Remember the selected space when the user visits Stock media and returns to Spaces.
- Handle many spaces with search and scrolling inside the dropdown. Do not show a long list in the sidebar, move the latest choice to the top, or replace fixed rows.

This is the agreed UI structure. Teams and projects are still different concepts. This design does not define access rules or make every project a team space.

### 3. Browse and add media

- Grid and list views, search by name, and **All / Image / Video / Audio** filters.
- **All sources / Uploaded / Generated** filters for media in Spaces.
- Upload, preview, rename, download, and delete.
- Click a thumbnail to see details. Use checkboxes to select several files.
- The footer shows the selection count, **Clear selection**, and **Add N items to canvas**.
- Keep selected files when filters change. Show how many selected files are outside the current filter. Clear the selection when switching spaces or moving to Stock media.
- Adding several files creates several nodes. Place them next to each other without overlap. **One Undo removes the whole batch.**
- Closing the details panel keeps the selection.
- Drag media onto the canvas to create an asset node. An input port accepts one compatible file, not a whole batch.

### 4. Details panel

- Show the preview, file name, media type, dimensions, duration, file size, and source information where available.
- Keep **one Rename action**: the pencil icon beside the file name. Remove the duplicate Rename button at the bottom.
- Give the **Download** button a clear text label.
- Do not show “Used by 0 nodes” or “Ready to use in your canvas”.
- Show **On this canvas** only when the asset is used. List the related nodes. This covers the current canvas, not the whole space.
- Clicking a related node closes the Media browser and moves the view to that node.
- Before deleting an asset that is in use, explain which nodes will be affected. Keep the original issue requirement for the INPUT_REQUIRED state.

### 5. Generated asset metadata — agreed, not yet added to the prototype

Show these fields when data is available:
- **Prompt:** text with expand/collapse and Copy controls.
- **References:** **input file names as text only**. No thumbnails, links, or tracing back through the graph.
- **Model / Generation settings:** the model and settings used to create the result. Longer details can be collapsed.

Save this information **when the asset is generated**. Do not show a node's current prompt as the prompt for an older output. For References, saving the input file names at run time is enough for this design. Hide fields when data is missing.

### 6. Video and audio previews — agreed, not yet added to the prototype

- **Video:** after about 400 ms of hover, play a muted preview. When the pointer leaves, stop playback and show the thumbnail again.
- **Audio:** show Play on hover. Sound starts only after a click. Click again to stop.
- Play only one preview at a time. Hovering over a checkbox or dragging to select must not start playback.
- Use a Play button on touch devices.

### 7. Ideas tested and left for later

- Do not use a nested Personal / Team / Project sidebar or a team list that changes order automatically.
- We tested a film version with **Characters / Scenes / Props**. Each item groups reference files. It is useful, but it adds film production asset management beyond the current basic goal.
- **The film version is outside issue #11.** Keep it as a reference and continue with the approved basic Spaces version.
- Leave the mini browser, character and outfit profiles, special collections, and organization-wide asset management for later.

### 8. Prototype status and implementation limits

**Already in the prototype:** space switching, sample Stock media, search and filters, grid/list views, previews, multi-selection, adding several nodes, batch Undo, and the simpler details panel. Checks covered adding three files as three nodes, undoing them in one step, keeping selections across filters, and choosing one file for an input.

**The prototype uses sample data and session-only state.** It does not prove that the backend, permissions, permanent storage, a virtualized list of 500 assets, or production end-to-end tests are complete.

The original issue says “No cross-project sharing” and uses the existing Asset contract and MinIO. The Spaces and Stock media design **does not change that boundary by itself**. Before implementation, confirm which data is available within this issue. Cross-project sharing or external stock service integration needs a separate scope decision. Keep the original technical acceptance criteria.

Prototype on the design machine:
- Approved basic version: `http://127.0.0.1:4180/`
- Source folder: `/Users/thao/Downloads/zcanvas-media-issue11-prototype/`
- Film reference version: `/film/` — not the version to implement.

These local addresses and paths work only on the design machine. The prototype is not hosted for shared access yet.
