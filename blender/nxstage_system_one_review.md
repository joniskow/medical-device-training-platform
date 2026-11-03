# System One photo-grounded reconstruction review

The earlier Aurora scene was based on the wrong synthetic fixture and should not be used for this device. The new target is the real machine shown in the uploaded 20-photo set.

## Confirmed visual structure

- Cream molded upper machine head with a broad sloped front fascia.
- Real front control artwork: three dark status windows, three stacked maroon display bands with green/yellow/coral end fields, left-side icons, green flow control, red octagonal stop control, and yellow mute control.
- Black protective side rails running vertically beside the head and across the front.
- White molded shelf/tray with rounded edge, recessed side pads, and a central dark insert.
- Lower black cart/base with casters and a smaller secondary front display/control module.
- Rear gray service cover, vent grids, central pole socket, electrical ports, labels, and cable/tube routing.
- Upper black accessory platform/case and stainless IV pole/hanger assembly visible in the photos.
- Distinctive side pivot plates and large black side handles.
- Upper black accessory case/platform with front window and captive fasteners.
- Asymmetric lower service face: offset secondary control module, connector strip, gray service cover, and warning label.

## Accuracy expectations

This is now a photo-grounded hard-surface reconstruction. The visible silhouette and component placement should be substantially more accurate than the prior scene. It is not honest to call it 100% accurate yet because the photos do not provide:

- a measured scale reference;
- orthographic front/side/back/top captures;
- unobstructed views of every surface;
- exact CAD dimensions, wall thicknesses, or internal geometry.

The local photogrammetry pipeline was attempted with all 20 photos but failed camera registration because of occlusion, mixed framing, and insufficient consistent overlap. The script therefore uses explicit hard-surface geometry rather than treating a failed photogrammetry result as truth.

## Blender versus Babylon.js

Blender is the correct authoring tool for this asset: it is much better suited to the molded shell, bevels, rails, handles, service panels, tubing, and camera-based review. Babylon.js should remain the browser runtime for selection, animation, training state, and assessment. Export the finished Blender scene as a self-contained GLB and keep stable component/node names in the model manifest.

## Run

```powershell
blender -b --python blender\nxstage_system_one_scene.py
```

The generated authoring/render files are `blender/nxstage_system_one.blend` and
`fixtures/nxstage-system-one/nxstage-system-one-preview.png`. The runtime export is
`fixtures/nxstage-system-one-interactive/nxstage-system-one.glb`, paired with
`fixtures/nxstage-system-one-interactive/model-manifest.json` and provenance metadata. The
presentation floor, lights, and cameras are excluded from the GLB selection so the
browser loads only the device geometry.

The scene was exported and rendered with Blender 5.2.3. The manifest records the
geometry counts and source hash; the browser check loads those exact model bytes.

The current scene carries export-friendly interaction metadata for Flow, L/hr,
Stop, Mute and the six adjustment areas. The surrounding pale icon fields are
visual-only. The metadata describes bounded local press depth; it is an
authoring contract, not clinical control behavior. Browser-side pointer capture
keeps a pressed control latched until release or cancellation, including when a
drag leaves the mesh.

The visible control inks use the supplied frontal view for restrained hue and
matte-laminate tuning while keeping the authored press meshes and stable target
IDs. This is visual reconstruction evidence, not a calibrated colorimetric or
manufacturing claim.

This is a visual training reconstruction, not a clinical, regulatory, service, or manufacturing model.
