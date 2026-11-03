"""Build rigged mannequin with baked standing/seated shape presets using Blender CLI."""
from pathlib import Path
from math import radians
import json
import bpy
from mathutils import Matrix, Vector

OUT = Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(OUT / "mannequin-source.blend"))
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == rig)
rig.animation_data_clear()
body.animation_data_clear()
# The downloaded rig has constant-valued IK drivers. Switch its ORG limb blends
# explicitly to FK for deterministic background authoring.
for side in ('L', 'R'):
    for limb in ('upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'):
        bone = rig.pose.bones.get(f'ORG-{limb}.{side}')
        if bone:
            for constraint in bone.constraints:
                if constraint.type == 'COPY_TRANSFORMS' and 'ik' in constraint.subtarget:
                    constraint.driver_remove('influence')
                    constraint.influence = 0.0

def reset():
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    for side in ('L', 'R'):
        rig.pose.bones[f'upper_arm_parent.{side}']['IK_FK'] = 1.0
        rig.pose.bones[f'thigh_parent.{side}']['IK_FK'] = 1.0
    rig.update_tag()
    bpy.context.view_layer.update()

def rotate_world(name, axis, angle):
    bone = rig.pose.bones[name]
    head = bone.matrix.translation.copy()
    bone.matrix = (Matrix.Translation(head) @ Matrix.Rotation(radians(angle), 4, axis)
                   @ Matrix.Translation(-head) @ bone.matrix)
    bpy.context.view_layer.update()

def evaluate():
    bpy.context.view_layer.update()
    return bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))

reset()
neutral = evaluate()
poses = {}
for name in ('standing', 'sitting'):
    reset()
    for side, sign in (('L', 1), ('R', -1)):
        rotate_world(f'upper_arm_fk.{side}', 'Y', sign * 78)
    if name == 'sitting':
        for side in ('L', 'R'):
            rotate_world(f'thigh_fk.{side}', 'X', -90)
            rotate_world(f'shin_fk.{side}', 'X', 90)
            rotate_world(f'forearm_fk.{side}', 'X', -75)
        rig.pose.bones['torso'].location.z -= 0.40
        rig.update_tag()
    posed = evaluate()
    # Both poses stand on the same ground plane, independent of pelvis height.
    floor = min(v.co.z for v in posed.vertices)
    for vertex in posed.vertices:
        vertex.co.z -= floor
    poses[name] = posed
reset()

mesh = bpy.data.objects.new('Rayzee_Mannequin', neutral)
bpy.context.collection.objects.link(mesh)
for group in body.vertex_groups:
    mesh.vertex_groups.new(name=group.name)
mesh.parent = rig
modifier = mesh.modifiers.new('Rig', 'ARMATURE')
modifier.object = rig
mesh.shape_key_add(name='Basis')
for name, posed in poses.items():
    assert len(posed.vertices) == len(neutral.vertices)
    key = mesh.shape_key_add(name=name)
    for dst, src in zip(key.data, posed.vertices):
        dst.co = src.co
mesh['rayzeePoseModel'] = 'mannequin-v1'
mesh.data.shape_keys.key_blocks['standing'].value = 1.0

# Pose samples carry evaluated smooth normals through the glTF morph exporter.
bpy.ops.object.select_all(action='DESELECT')
for obj in (rig, mesh):
    obj.hide_set(False)
    obj.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.export_scene.gltf(
    filepath=str(OUT / 'mannequin-presets.glb'), export_format='GLB',
    use_selection=True, export_def_bones=True, export_animations=False,
    export_morph=True, export_morph_normal=True, export_extras=True,
)

# Render proof sheets without requiring Blender GUI access.
body.hide_render = True
for obj in bpy.data.objects:
    if obj.name.startswith('WGT-'):
        obj.hide_render = True
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new('Proof world')
scene.world.color = (0.35, 0.35, 0.35)
camera_data = bpy.data.cameras.new('Proof camera')
camera = bpy.data.objects.new('Proof camera', camera_data)
scene.collection.objects.link(camera)
camera.location = (3, -5, 2.5)
camera.rotation_euler = (Vector((0, -0.1, 0.9)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2.3
scene.camera = camera
light_data = bpy.data.lights.new('Proof light', 'AREA')
light = bpy.data.objects.new('Proof light', light_data)
scene.collection.objects.link(light)
light.location = (1, -3, 4)
light.rotation_euler = (Vector((0, 0, 1)) - light.location).to_track_quat('-Z', 'Y').to_euler()
light_data.energy = 500
light_data.shape = 'DISK'
light_data.size = 4
for name in poses:
    for key in mesh.data.shape_keys.key_blocks:
        key.value = float(key.name == name)
    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)

summary = {name: {'vertices': len(p.vertices), 'height': max(v.co.z for v in p.vertices),
                 'floor': min(v.co.z for v in p.vertices)} for name, p in poses.items()}
(OUT / 'pose-validation.json').write_text(json.dumps(summary, indent=2))
for key in mesh.data.shape_keys.key_blocks:
    key.value = float(key.name == 'standing')
body.hide_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'mannequin-presets.blend'))
