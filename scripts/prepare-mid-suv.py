"""CLI: Blender --background --factory-startup --disable-autoexec --python
scripts/prepare-mid-suv.py -- --source '/path/KB3D_Mid SUV.blend'

Leaves the supplied files intact. Exports a textured GLB and an editable hinge rig.
"""
import argparse
from collections import defaultdict
import json
from math import radians
from pathlib import Path
import sys
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--texture-size', type=int, default=1024)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
repo = Path(__file__).resolve().parents[1]
out = repo / 'app/public/vehicles/mid-suv'
work = repo.parent / 'assets/suv-investigation'
out.mkdir(parents=True, exist_ok=True)
work.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(args.source))
linked = 0
for image in bpy.data.images:
    if not image.filepath:
        continue
    source = args.source.parent / image.filepath.replace('\\', '/').split('/')[-1]
    if not source.is_file():
        raise FileNotFoundError(source)
    image.filepath = str(source)
    image.reload()
    linked += 1

root = bpy.data.objects['KB3D_CEV_VehicMidSUV_A_grp']
root.name = 'KB3D_Mid_SUV'
root['rayzeeVehicleModel'] = 'kb3d-mid-suv-v1'
hinges = []
for side, suffix, sign in [('left', 'L', 1), ('right', 'R', -1)]:
    door = bpy.data.objects[f'KB3D_CEV_VehicMidSUV_A_FrontDoor{suffix}']
    hinge = bpy.data.objects.new(f'FrontDoor_{side}_Hinge', None)
    bpy.context.collection.objects.link(hinge)
    hinge.parent = root
    # Forward edge of the lower door, slightly inboard of the exterior skin.
    hinge.location = (-1.10 if side == 'left' else 1.10, -1.015, 1.0)
    hinge.empty_display_type = 'ARROWS'
    hinge.empty_display_size = 0.3
    hinge['rayzeeVehicleDoor'] = side
    hinge['rayzeeDoorOpenDegrees'] = sign * 65
    bpy.context.view_layer.update()
    closed_world = door.matrix_world.copy()
    door.parent = hinge
    door.matrix_world = closed_world
    hinges.append(hinge)

# The source atlas material serves glass, lamps, and small interior elements.
# Assign only its window islands to a duplicate material; texture links and UVs
# stay unchanged. Source-space bounds were inspected in the supplied model:
# windows start above 1.36m, while every lamp/interior island starts below it.
translucent = bpy.data.materials['KB3D_CEV_TranslElemMidSUV']
glass = translucent.copy()
glass.name = 'KB3D_MidSUV_WindowGlass'
glass['rayzeeVehicleWindowGlass'] = True
window_polygons = 0
for obj in [root, *root.children_recursive]:
    if obj.type != 'MESH':
        continue
    polygons = [p for p in obj.data.polygons if obj.material_slots[p.material_index].material == translucent]
    if not polygons:
        continue
    adjacent = defaultdict(list)
    for polygon in polygons:
        for vertex in polygon.vertices:
            adjacent[vertex].append(polygon.index)
    pending = {p.index for p in polygons}
    windows = []
    while pending:
        queue = [pending.pop()]
        island = []
        while queue:
            polygon = obj.data.polygons[queue.pop()]
            island.append(polygon)
            for vertex in polygon.vertices:
                for neighbour in adjacent[vertex]:
                    if neighbour in pending:
                        pending.remove(neighbour)
                        queue.append(neighbour)
        minimum_z = min((obj.matrix_world @ obj.data.vertices[v].co).z for p in island for v in p.vertices)
        if minimum_z > 1.36:
            windows.extend(island)
    if windows:
        slot = len(obj.data.materials)
        obj.data.materials.append(glass)
        for polygon in windows:
            polygon.material_index = slot
        window_polygons += len(windows)
if window_polygons != 1860:
    raise RuntimeError(f'Window island classification changed: {window_polygons} polygons')

# Retain the full-resolution editable source with relinked images.
bpy.ops.wm.save_as_mainfile(filepath=str(work / 'mid-suv-rigged.blend'))

# Downsample only images used by exported glTF material channels. Height maps
# are retained in the source but aren't part of the web PBR material pipeline.
used = set()
for material in bpy.data.materials:
    if not material.node_tree:
        continue
    for node in material.node_tree.nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            targets = {link.to_node.type for socket in node.outputs for link in socket.links}
            if targets and targets != {'DISPLACEMENT'}:
                used.add(node.image)
for image in used:
    width, height = image.size
    if max(width, height) > args.texture_size:
        factor = args.texture_size / max(width, height)
        image.scale(max(1, round(width * factor)), max(1, round(height * factor)))

bpy.ops.object.select_all(action='DESELECT')
objects = [root, *root.children_recursive]
for obj in objects:
    obj.hide_set(False)
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(filepath=str(out / 'mid-suv.glb'), export_format='GLB',
                          use_selection=True, export_extras=True,
                          export_animations=False, export_cameras=False,
                          export_lights=False, export_image_format='JPEG',
                          export_image_quality=90)

# Isolated proof renders. Existing source camera/lights are excluded.
for obj in list(bpy.context.scene.objects):
    if obj.type in {'CAMERA', 'LIGHT'}:
        bpy.data.objects.remove(obj, do_unlink=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 900
scene.render.resolution_y = 650
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new('SUV Proof World')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.35, 0.35, 1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
camera = bpy.data.objects.new('SUV Proof Camera', bpy.data.cameras.new('SUV Proof Camera'))
scene.collection.objects.link(camera)
camera.location = (-8, -10, 6)
camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 8.5
scene.camera = camera
for name, location, power, size in [('Key', (-4, -5, 8), 1800, 6), ('Fill', (5, -1, 5), 1200, 5)]:
    light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 1)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    light.data.energy = power
    light.data.size = size
for pose in ['closed', 'both-open']:
    for hinge in hinges:
        hinge.rotation_euler.z = radians(hinge['rayzeeDoorOpenDegrees']) if pose == 'both-open' else 0
    scene.render.filepath = str(out / f'{pose}.png')
    bpy.ops.render.render(write_still=True)

(work / 'rig-summary.json').write_text(json.dumps({
    'source': str(args.source), 'relinkedImages': linked,
    'textureMaxSize': args.texture_size,
    'windowPolygons': window_polygons,
    'hinges': [{'name': h.name, 'side': h['rayzeeVehicleDoor'],
                'blenderPivot': list(h.location), 'openDegrees': h['rayzeeDoorOpenDegrees']}
               for h in hinges],
    'glbBytes': (out / 'mid-suv.glb').stat().st_size,
}, indent=2))
