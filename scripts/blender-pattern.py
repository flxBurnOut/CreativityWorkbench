"""Place a bounded image on only the outer wall of our known vessel recipes."""
import argparse
import hashlib
import json
import math
import os
import struct
import sys
import traceback

import bpy

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--mode', choices=['apply', 'verify'], required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
root = os.path.realpath(args.output)


def report_failure(kind, error, trace):
    # A small local diagnostic survives until the caller cleans its owned stage.
    with open(os.path.join(root, 'pattern-error.log'), 'w', encoding='utf-8') as stream:
        stream.write(''.join(traceback.format_exception(kind, error, trace))[-4096:])
    sys.__excepthook__(kind, error, trace)


sys.excepthook = report_failure
with open(os.path.join(root, 'source-plan.json'), encoding='utf-8') as stream:
    plan = json.load(stream)
ring_counts = {'bowl': 6, 'plate': 5, 'basin': 5, 'vase': 8, 'jar': 7, 'pot': 5, 'teapot': 7, 'ladle': 5}
if plan['kind'] not in ring_counts:
    raise ValueError('Unsupported vessel kind; architecture needs a separate UV recipe')
bpy.ops.wm.open_mainfile(filepath=os.path.join(root, 'source.blend' if args.mode == 'apply' else 'asset.blend'), load_ui=False, use_scripts=False)
bpy.context.preferences.filepaths.save_version = 0
objects = sorted([obj for obj in bpy.context.scene.objects if obj.type == 'MESH'], key=lambda obj: obj.name)
body = bpy.data.objects.get('Vessel with inner wall and bottom')
segments, rings = 64, ring_counts[plan['kind']]
outer_count = (rings - 1) * segments


def inspect():
    if not 1 <= len(objects) <= 240 or len(objects) != len(bpy.context.scene.objects):
        raise ValueError('Unsupported scene objects')
    digest, vertices, triangles = hashlib.sha256(), 0, 0
    mins, maxs = [math.inf] * 3, [-math.inf] * 3
    for obj in objects:
        data = obj.data
        if obj.modifiers or len(data.uv_layers) != 1:
            raise ValueError('Only final meshes with one UV map are supported')
        data.calc_loop_triangles()
        vertices += len(data.vertices)
        triangles += len(data.loop_triangles)
        if vertices > 120000 or triangles > 40000:
            raise ValueError('Mesh budget exceeded')
        digest.update(obj.name.encode('utf-8'))
        for vertex in data.vertices:
            point = obj.matrix_world @ vertex.co
            if any(not math.isfinite(v) for v in point):
                raise ValueError('Invalid vertex')
            digest.update(struct.pack('<3d', *point))
            for axis in range(3):
                mins[axis] = min(mins[axis], point[axis])
                maxs[axis] = max(maxs[axis], point[axis])
        for face in data.polygons:
            digest.update(struct.pack('<I', len(face.vertices)))
            digest.update(struct.pack('<' + 'I' * len(face.vertices), *face.vertices))
    dimensions = [round(maxs[i] - mins[i], 6) for i in range(3)]
    if triangles < 4 or any(v <= 0 or v > 100 for v in dimensions):
        raise ValueError('Invalid bounds')
    return {'geometryHash': digest.hexdigest(), 'stats': {'vertices': vertices, 'triangles': triangles, 'objects': len(objects), 'materials': len({slot.material.name for obj in objects for slot in obj.material_slots if slot.material}), 'dimensions': dimensions, 'unit': 'm'}}


def identify_outer_wall():
    # Never guess arbitrary imported topology. Check every recipe face and the
    # orientation of outer normals before modifying material assignments.
    if body not in objects or not body.get('open_mouth') or len(body.data.vertices) != rings * 2 * segments + 2:
        raise ValueError('The original vessel recipe cannot be identified')
    expected = []
    for j in range(rings * 2 - 1):
        for n in range(segments):
            a, b = j * segments + n, j * segments + (n + 1) % segments
            expected.append((a, b, b + segments, a + segments))
    bottom, top = rings * 2 * segments, rings * 2 * segments + 1
    for n in range(segments):
        expected.append((bottom, (n + 1) % segments, n))
        expected.append((top, (rings * 2 - 1) * segments + n, (rings * 2 - 1) * segments + (n + 1) % segments))
    if len(body.data.polygons) != len(expected) or any(tuple(face.vertices) != indices for face, indices in zip(body.data.polygons, expected)):
        raise ValueError('Vessel topology does not match the trusted recipe')
    height = plan['dimensions']['height'] / 100
    for j in range(rings):
        group = body.data.vertices[j * segments:(j + 1) * segments]
        if max(v.co.z for v in group) - min(v.co.z for v in group) > 1e-6:
            raise ValueError('Outer rings are no longer horizontal')
    if abs(body.data.vertices[0].co.z) > 1e-6 or abs(body.data.vertices[(rings - 1) * segments].co.z - height) > 1e-6:
        raise ValueError('Source plan height no longer matches mesh')
    for face in body.data.polygons[:outer_count]:
        if face.normal.x * face.center.x + face.normal.y * face.center.y <= 0:
            raise ValueError('Outer face orientation is invalid')


def material_values(mat):
    if not mat or not mat.use_nodes:
        raise ValueError('Source material is unsupported')
    shader = mat.node_tree.nodes.get('Principled BSDF')
    if shader is None:
        raise ValueError('Source shader is unsupported')
    return {'name': mat.name, 'color': list(shader.inputs['Base Color'].default_value), 'roughness': shader.inputs['Roughness'].default_value, 'metallic': shader.inputs['Metallic'].default_value, 'images': sorted(node.image.name for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image)}


def protected_hash():
    digest = hashlib.sha256()
    for obj in objects:
        layer = obj.data.uv_layers.active.data
        for face in obj.data.polygons:
            if obj == body and face.index < outer_count:
                continue
            digest.update(json.dumps([obj.name, face.index, material_values(obj.data.materials[face.material_index])], sort_keys=True).encode('utf-8'))
            for index in face.loop_indices:
                digest.update(struct.pack('<2d', *layer[index].uv))
    return digest.hexdigest()


def outer_hash():
    digest = hashlib.sha256()
    uv = body.data.uv_layers.active.data
    for face in body.data.polygons[:outer_count]:
        digest.update(json.dumps(material_values(body.data.materials[face.material_index]), sort_keys=True).encode('utf-8'))
        coords = [tuple(uv[index].uv) for index in face.loop_indices]
        if any(not math.isfinite(c) or c < -1e-6 or c > 1 + 1e-6 for point in coords for c in point) or max(p[0] for p in coords) - min(p[0] for p in coords) > .04:
            raise ValueError('Outer UV has an invalid cylindrical seam')
        for point in coords:
            digest.update(struct.pack('<2d', *point))
    return digest.hexdigest()


before = inspect()
identify_outer_wall()
if args.mode == 'apply':
    before['protectedHash'] = protected_hash()
    image = bpy.data.images.load(os.path.join(root, 'pattern-atlas.png'), check_existing=False)
    if not 1 <= image.size[0] <= 1024 or not 1 <= image.size[1] <= 1024:
        raise ValueError('Pattern image budget exceeded')
    image.name = 'Generated cultural wrap'
    image.colorspace_settings.name = 'sRGB'
    image.pack()
    faces = body.data.polygons[:outer_count]
    old_indices = {face.material_index for face in faces}
    protected_indices = {face.material_index for face in body.data.polygons[outer_count:]}
    replacements, material_checks = {}, []
    for index in old_indices:
        source = body.data.materials[index]
        values = material_values(source)
        mat = source.copy()
        mat.name = 'Cultural outer glaze'
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        for node in list(nodes):
            if node.type == 'TEX_IMAGE':
                nodes.remove(node)
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        texture.extension = 'REPEAT'
        links.new(texture.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
        if index not in protected_indices:
            body.data.materials[index] = mat
            replacements[index] = index
        else:
            body.data.materials.append(mat)
            replacements[index] = len(body.data.materials) - 1
        material_checks.append({'name': mat.name, 'roughness': values['roughness'], 'metallic': values['metallic']})
    uv, height, aspect = body.data.uv_layers.active.data, plan['dimensions']['height'] / 100, plan['dimensions']['depth'] / plan['dimensions']['width']
    for face in faces:
        coords = []
        for index in face.loop_indices:
            co = body.data.vertices[body.data.loops[index].vertex_index].co
            u = (math.atan2(co.y / aspect, co.x) / math.tau) % 1
            if u > 1 - 1e-7:
                u = 0
            coords.append((u, min(1, max(0, co.z / height))))
        if max(p[0] for p in coords) - min(p[0] for p in coords) > .5:
            coords = [(u + 1 if u < .5 else u, v) for u, v in coords]
        for index, point in zip(face.loop_indices, coords):
            uv[index].uv = point
        face.material_index = replacements[face.material_index]
    if inspect()['geometryHash'] != before['geometryHash'] or protected_hash() != before['protectedHash']:
        raise ValueError('Pattern application changed geometry or protected surfaces')
    before.update({'outerHash': outer_hash(), 'materialChecks': material_checks, 'decoratedFaces': outer_count, 'protectedFaces': sum(len(obj.data.polygons) for obj in objects) - outer_count, 'patternImage': image.name})
    # Repeated runs replace outer-only slots; unused images/materials must not
    # accumulate invisibly in the exported Blend.
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    for old in list(bpy.data.images):
        if old != image and old.users == 0:
            bpy.data.images.remove(old)
    with open(os.path.join(root, 'pattern-before.json'), 'w', encoding='utf-8') as stream:
        json.dump(before, stream)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root, 'asset.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(root, 'asset.glb'), export_format='GLB', export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_animations=False, export_cameras=False, export_lights=False, export_extras=False)
else:
    with open(os.path.join(root, 'pattern-before.json'), encoding='utf-8') as stream:
        expected = json.load(stream)
    if before['geometryHash'] != expected['geometryHash'] or protected_hash() != expected['protectedHash'] or outer_hash() != expected['outerHash']:
        raise ValueError('Reopened model differs from verified mapping')
    for check in expected['materialChecks']:
        current = material_values(bpy.data.materials.get(check['name']))
        if any(current[key] != check[key] for key in ['roughness', 'metallic']):
            raise ValueError('Glaze properties changed')
    image = bpy.data.images.get(expected['patternImage'])
    images = [im for im in bpy.data.images if im.type == 'IMAGE' and im.users > 0]
    if image not in images or len(images) > 8 or any(not im.packed_file or max(im.size) > 1024 for im in images):
        raise ValueError('Texture was not embedded or exceeds the image budget')
    before.update({'reopened': True, 'packedTextures': True, 'geometryPreserved': True, 'protectedSurfacesPreserved': True, 'uvValidated': True, 'materialsPreserved': True, 'decoratedFaces': expected['decoratedFaces'], 'protectedFaces': expected['protectedFaces'], 'protectedHash': expected['protectedHash'], 'outerHash': expected['outerHash']})
    with open(os.path.join(root, 'validation.json'), 'w', encoding='utf-8') as stream:
        json.dump(before, stream)
