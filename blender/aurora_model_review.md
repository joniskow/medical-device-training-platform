# Aurora Infusion Controller — detailed visual review and Blender modeling brief

## Scope and evidence

The available source set is the synthetic AIC-001 fixture:

- `fixtures/reference/images/aic-overview.png`
- `fixtures/reference/images/aic-control-panel.png`
- `fixtures/reference/images/aic-safety-cover.png`
- reconstruction preview images under `output/aurora-reconstruction-01/`
- the canonical component GLB at `fixtures/reference/model/aurora-infusion-controller.glb`

The three labeled reference drawings are schematic illustrations, not calibrated photographs. The reconstruction previews add overall silhouette and placement cues, but they are noisy and do not establish exact dimensions. The canonical GLB is a semantic fixture with only one triangle per required component, so it is useful for naming and interaction mapping but not as a detailed manufacturing mesh.

## Visual observations translated into geometry

### Overall enclosure

The device reads as a tall, compact, rounded rectangular controller with a light warm-white enclosure. The large faces are mostly planar, with softened vertical corners and a slightly darker edge/trim treatment. The silhouette is intentionally simple: a vertical body, a stable flat base, and a small amount of hardware extending from the right side.

### Top hardware

The orbit captures show a centered carrying handle: two short support posts rise from the top shell and connect to a broad rectangular grip with a dark underside gap. The Blender scene models the grip, supports, shadow gap, and grip ribs as a separate `Top carrying handle` collection. This supersedes the first-pass interpretation of the top as two separate modules.

### Control panel — AIC-C01

The front-facing schematic shows a dark navy rectangular panel inset into the enclosure. It contains three circular controls arranged horizontally:

1. mint/teal — Prime;
2. amber/yellow — Ready;
3. red — Shutdown/Stop.

The Blender scene uses a dark bezel, a darker inner plate, black button rings, raised colored caps, and small labels. The labels are a readability aid based on the fixture manual and component names; their exact typography and position are not established by the source images.

### Safety cover — AIC-C02

The safety-cover reference uses an amber/gold visual treatment and explicitly indicates that the cover is open before simulated priming. The scene therefore uses a transparent amber polycarbonate shield with an orange edge rim, a visible hinge, and a pivot object named `Safety cover hinge pivot`. The cover is placed open in the hero view; rotate the pivot to produce the closed state.

### Line sensor — AIC-C03

The reconstruction previews show a removable side assembly on the right side. The scene models a mounting post, upper and lower dark housings, two light rollers, a smoked optical window, an orange line passing through the sensor, and a black sensor cable. This is a visual interpretation of the visible silhouette, not a claim about the internal sensing method.

### Small manufacturing cues

To make the object read as a manufactured training device rather than a blockout, the scene adds:

- consistent edge radii on enclosure and hardware;
- lower service seam and corner fasteners;
- side inset panels;
- a rear identification plate;
- modest material variation between ABS, graphite, satin metal, rubber, amber plastic, and tubing.

## Modeling assumptions and confidence

High confidence: component count, front-panel color order, safety-cover presence, line-sensor presence, tall enclosure silhouette, and the semantic component names.

Medium confidence: two top modules, relative placement of the side sensor, approximate panel elevation, and the use of an amber transparent cover.

Low confidence: physical scale, wall thickness, hidden rear geometry, exact hinge axis, exact button dimensions, exact sensor mechanism, fastener count, typography, and manufacturing tolerances.

The script records this status as custom properties on the scene and top-level collection so the uncertainty travels with the Blender file.

## How to generate the Blender file

1. Install Blender 4.x.
2. From the repository root, run:

   ```powershell
   blender -b --python blender/aurora_controller_scene.py
   ```

3. The script writes `blender/aurora_infusion_controller.blend` and `blender/aurora_hero.png` when run from the repository root. If Blender is launched from another working directory, use Blender's Scripting workspace or change the output paths in the script.

4. Open the `.blend` file and use the cameras `CAM_Hero`, `CAM_Front`, `CAM_Sensor`, and `CAM_Back` for review.

This is a detailed visual training model. It is not a validated clinical, engineering, or manufacturing representation.
