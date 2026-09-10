"""Apply a bounded color atlas to our existing mesh. No geometry generation."""
import argparse
import hashlib
import json
import math
import os
import struct
import sys

import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--mode', choices=['prepare', 'apply', 'verify'], required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = os.path.realpath(args.output)
source = os.path.join(root, {'prepare': 'source.blend', 'apply': 'prepared.blend', 'verify': 'asset.blend'}[args.mode])
bpy.ops.wm.open_mainfile(filepath=source, load_ui=False, use_scripts=False)
bpy.context.preferences.filepaths.save_version = 0
objects = sorted([o for o in bpy.context.scene.objects if o.type == 'MESH'], key=lambda o: o.name)


def inspect():
    if not 1 <= len(objects) <= 240:
        raise ValueError('Mesh object budget exceeded')
    digest = hashlib.sha256()
    vertices, triangles, mins, maxs = 0, 0, [math.inf] * 3, [-math.inf] * 3
    for obj in objects:
        data = obj.data
        if obj.modifiers:
            raise ValueError('Texture input must contain final mesh geometry')
        data.calc_loop_triangles()
        vertices += len(data.vertices)
        triangles += len(data.loop_triangles)
        if vertices > 120000 or triangles > 40000 or not data.uv_layers:
            raise ValueError('Mesh or UV budget exceeded')
        digest.update(obj.name.encode('utf-8'))
        for vertex in data.vertices:
            point = obj.matrix_world @ vertex.co
            if any(not math.isfinite(v) for v in point):
                raise ValueError('Invalid mesh coordinate')
            digest.update(struct.pack('<3d', *point))
            for axis in range(3):
                mins[axis] = min(mins[axis], point[axis])
                maxs[axis] = max(maxs[axis], point[axis])
        for face in data.polygons:
            digest.update(struct.pack('<I', len(face.vertices)))
            digest.update(struct.pack('<' + 'I' * len(face.vertices), *face.vertices))
    dimensions = [round(maxs[i] - mins[i], 6) for i in range(3)]
    if triangles < 4 or any(v <= 0 or v > 100 for v in dimensions):
        raise ValueError('Invalid model bounds')
    return {'geometryHash': digest.hexdigest(), 'stats': {'vertices': vertices, 'triangles': triangles, 'objects': len(objects), 'materials': max(1, len({slot.material.name for obj in objects for slot in obj.material_slots if slot.material})), 'dimensions': dimensions, 'unit': 'm'}}


def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_animations=False, export_cameras=False, export_lights=False, export_extras=False)


report = inspect()
if args.mode == 'prepare':
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    if inspect()['geometryHash'] != report['geometryHash']:
        raise ValueError('UV preparation changed geometry')
    with open(os.path.join(root, 'geometry.json'), 'w', encoding='utf-8') as stream:
        json.dump(report, stream)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root, 'prepared.blend'))
    # The provider receives only white mesh with packed UVs. The prepared Blend
    # retains original roughness/material choices for the final color atlas.
    neutral = bpy.data.materials.new('Texture input white mesh')
    neutral.use_nodes = True
    neutral.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.8, .8, .8, 1)
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(neutral)
        for face in obj.data.polygons:
            face.material_index = 0
    export(os.path.join(root, 'input.glb'))
else:
    with open(os.path.join(root, 'geometry.json'), 'r', encoding='utf-8') as stream:
        expected = json.load(stream)
    if report['geometryHash'] != expected['geometryHash']:
        raise ValueError('Texture stage changed the original mesh')
    if args.mode == 'apply':
        image = bpy.data.images.load(os.path.join(root, 'texture.png'), check_existing=False)
        if not 1 <= image.size[0] <= 1024 or not 1 <= image.size[1] <= 1024:
            raise ValueError('Texture budget exceeded')
        image.name = 'AI cultural color atlas'
        image.colorspace_settings.name = 'sRGB'
        image.pack()
        materials = {slot.material for obj in objects for slot in obj.material_slots if slot.material}
        if not materials:
            raise ValueError('Original materials are missing')
        for mat in materials:
            mat.use_nodes = True
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            shader = nodes.get('Principled BSDF')
            if shader is None:
                raise ValueError('Unsupported original material')
            for node in list(nodes):
                if node.type == 'TEX_IMAGE':
                    nodes.remove(node)
            texture = nodes.new('ShaderNodeTexImage')
            texture.image = image
            links.new(texture.outputs['Color'], shader.inputs['Base Color'])
        for old in list(bpy.data.images):
            if old != image and old.users == 0:
                bpy.data.images.remove(old)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root, 'asset.blend'))
        export(os.path.join(root, 'asset.glb'))
    else:
        images = [im for im in bpy.data.images if im.type == 'IMAGE' and im.users > 0]
        if not images or any(not im.packed_file or max(im.size) > 1024 for im in images):
            raise ValueError('Color texture not embedded or over budget')
        report.update({'reopened': True, 'packedTextures': True, 'geometryPreserved': True})
        with open(os.path.join(root, 'validation.json'), 'w', encoding='utf-8') as stream:
            json.dump(report, stream)
