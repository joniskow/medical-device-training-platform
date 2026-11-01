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

The generated files are `blender/nxstage_system_one.blend` and `blender/nxstage_system_one_preview.png`.

This is a visual training reconstruction, not a clinical, regulatory, service, or manufacturing model.
