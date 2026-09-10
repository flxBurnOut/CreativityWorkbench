"""Trusted bounded mesh recipes. The input is data, never Python source."""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector


parser = argparse.ArgumentParser()
parser.add_argument('--plan', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--mode', choices=['build', 'verify'], required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
with open(args.plan, 'r', encoding='utf-8') as stream:
    plan = json.load(stream)
root = os.path.realpath(args.output)
if os.path.dirname(os.path.realpath(args.plan)) != root:
    raise ValueError('Plan must belong to the owned output directory')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1.0
bpy.context.scene.render.threads_mode = 'FIXED'
bpy.context.scene.render.threads = 2


def linear_color(value):
    values = [int(value[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return [(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) for v in values]


def material(name, color, roughness=.65, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear_color(color), 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    mat.diffuse_color = (*linear_color(color), 1)
    return mat


base_mat = material('Body', plan['material']['color'], plan['material']['roughness'], plan['material']['metallic'])
accent_mat = material('Accent', plan['decoration']['color'], .48)
roof_mat = material('Roof tile', '#455957', .88)
wood_mat = material('Wood', '#574c3c', .8)


def pattern_material():
    style = plan['decoration']['style']
    if style == 'plain':
        return base_mat
    image = bpy.data.images.new('Original procedural ornament', width=256, height=256, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    # Generated colors are scene linear; Blender writes the packed PNG with sRGB encoding.
    bg, fg = linear_color(plan['material']['color']), linear_color(plan['decoration']['color'])
    pixels = []
    for y in range(256):
        for x in range(256):
            u, v = x / 256, y / 256
            if style == 'lattice':
                a, b = (u + v) * 8 % 1, (u - v) * 8 % 1
                ink = min(a, 1 - a, b, 1 - b) < .065
            else:
                dx, dy = (u * 6 % 1) - .5, (v * 3 % 1) - .5
                radius, angle = math.hypot(dx, dy), math.atan2(dy, dx)
                edge = .23 + .085 * math.cos(angle * 5)
                ink = abs(radius - edge) < .028 or radius < .05
            color = fg if ink else bg
            pixels.extend((*color, 1.0))
    image.pixels.foreach_set(pixels)
    image.file_format = 'PNG'
    image.filepath_raw = os.path.join(root, 'ornament.png')
    image.save()
    image.pack()
    # The saved .blend must remain usable after the owned job directory is cleaned.
    # Remove the generated sidecar immediately; subsequent reopen/export proves the
    # packed texture is sufficient, instead of accidentally relying on that file.
    os.remove(image.filepath_raw)
    mat = base_mat.copy()
    mat.name = 'Original ornamental glaze'
    texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    mat.node_tree.links.new(texture.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    return mat


decorated_mat = pattern_material() if args.mode == 'build' else base_mat


def mesh(name, vertices, faces, mat=base_mat, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    layer = data.uv_layers.new(name='UVMap')
    for poly in data.polygons:
        poly.use_smooth = smooth
        normal = poly.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        uv_axes = [i for i in range(3) if i != axis]
        for loop_index in poly.loop_indices:
            co = data.vertices[data.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = (co[uv_axes[0]], co[uv_axes[1]])
    return obj


def box(name, x, y, z, w, d, h, mat=base_mat):
    vertices = [(x + sx * w / 2, y + sy * d / 2, z + sz * h / 2) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    return mesh(name, vertices, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)], mat)


def lathe(name, rings, rx=1, ry=1, mat=base_mat, segments=64, offset=(0, 0, 0)):
    vertices, faces = [], []
    for radius, z in rings:
        for n in range(segments):
            angle = n * 2 * math.pi / segments
            vertices.append((radius * math.cos(angle) * rx + offset[0], radius * math.sin(angle) * ry + offset[1], z + offset[2]))
    for j in range(len(rings) - 1):
        for n in range(segments):
            a, b = j * segments + n, j * segments + (n + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    vertices.extend([(offset[0], offset[1], rings[0][1] + offset[2]), (offset[0], offset[1], rings[-1][1] + offset[2])])
    bottom, top = len(vertices) - 2, len(vertices) - 1
    for n in range(segments):
        faces.append((bottom, (n + 1) % segments, n))
        a, b = (len(rings) - 1) * segments + n, (len(rings) - 1) * segments + (n + 1) % segments
        faces.append((top, a, b))
    obj = mesh(name, vertices, faces, mat, True)
    uv = obj.data.uv_layers.active.data
    for j in range(len(rings) - 1):
        for n in range(segments):
            poly = obj.data.polygons[j * segments + n]
            points = [(n / segments, j / max(1, len(rings) - 1)), ((n + 1) / segments, j / max(1, len(rings) - 1)), ((n + 1) / segments, (j + 1) / max(1, len(rings) - 1)), (n / segments, (j + 1) / max(1, len(rings) - 1))]
            for loop, value in zip(poly.loop_indices, points):
                uv[loop].uv = value
    return obj


def tube_path(name, points, radius, mat=base_mat, sides=12):
    vertices, faces = [], []
    for index, point in enumerate(points):
        tangent = Vector(points[min(index + 1, len(points) - 1)]) - Vector(points[max(index - 1, 0)])
        tangent.normalize()
        side = tangent.cross(Vector((0, 1, 0)))
        if side.length < .001:
            side = tangent.cross(Vector((0, 0, 1)))
        side.normalize()
        other = tangent.cross(side).normalized()
        for n in range(sides):
            angle = n * math.tau / sides
            vertices.append(tuple(Vector(point) + radius * (math.cos(angle) * side + math.sin(angle) * other)))
    for j in range(len(points) - 1):
        for n in range(sides):
            a, b = j * sides + n, j * sides + (n + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend([tuple(reversed(range(sides))), tuple((len(points) - 1) * sides + n for n in range(sides))])
    return mesh(name, vertices, faces, mat, True)


dimensions = plan['dimensions']
width, height, depth, wall = [dimensions[key] / 100 for key in ['width', 'height', 'depth', 'wallThickness']]
details, kind = plan['details'], plan['kind']


def vessel():
    profiles = {
        'bowl': [(0, .30), (.08, .45), (.20, .64), (.40, .82), (.70, .95), (1, 1)],
        'plate': [(0, .65), (.15, .68), (.30, .80), (.65, .93), (1, 1)],
        'basin': [(0, .66), (.06, .68), (.45, .83), (.90, .98), (1, 1)],
        'vase': [(0, .45), (.08, .50), (.30, .91), (.46, 1), (.65, .83), (.80, .40), (.95, .38), (1, .46)],
        'jar': [(0, .65), (.06, .68), (.30, .99), (.68, 1), (.86, .84), (.95, .60), (1, .61)],
        'pot': [(0, .68), (.08, .76), (.30, .90), (.68, .98), (1, 1)],
        'teapot': [(0, .45), (.10, .65), (.35, .95), (.55, 1), (.80, .90), (.98, .60), (1, .60)],
        'ladle': [(0, .30), (.15, .53), (.45, .78), (.80, .94), (1, 1)],
    }
    profile = profiles[kind]
    radius = width / 2
    if details['profile'] == 'tapered':
        profile = [(z, r * (.75 + .25 * z)) for z, r in profile]
    elif details['profile'] == 'flared':
        profile = [(z, min(1, r * (.82 + .18 * z))) for z, r in profile]
    outer = [(r * radius, z * height) for z, r in profile]
    # Outer base -> rim -> inner lip -> inner wall -> inner floor. The two
    # center fans close the underside and inner floor without sealing the mouth.
    inner = [(max(r * .12, r - wall), max(wall, z)) for r, z in outer]
    inner[0] = (max(outer[0][0] * .12, outer[0][0] - wall), wall)
    rings = outer + list(reversed(inner))
    body = lathe('Vessel with inner wall and bottom', rings, 1, depth / width, decorated_mat)
    body['wall_thickness_cm'] = dimensions['wallThickness']
    body['open_mouth'] = True
    lip = outer[-1][0]
    if details['lid']:
        lathe('Lid', [(lip * .97, height + wall * .12), (lip * 1.03, height + wall * .7), (lip * .80, height + wall * 1.2), (lip * .30, height + wall * 1.8)], 1, depth / width, base_mat)
        lathe('Lid knob', [(wall * 1.3, 0), (wall * 1.6, wall), (wall * .9, wall * 2)], 1, 1, accent_mat, 24, (0, 0, height + wall * 1.8))
    for n in range(details['handles']):
        sign = -1 if n == 0 else 1
        if details['spout'] and details['handles'] == 1:
            sign = -1
        points = []
        for j in range(25):
            angle = -math.pi / 2 + math.pi * j / 24
            offset = sign * (radius * .87 + radius * .55 * math.cos(angle))
            z = height * .53 + height * .32 * math.sin(angle)
            points.append((0, offset * depth / width, z) if details['spout'] and details['handles'] == 2 else (offset, 0, z))
        tube_path('Handle %d' % (n + 1), points, max(wall * .8, radius * .045), accent_mat)
    if details['spout']:
        # Annular mouth and inner bore, closed only at the body attachment.
        length = radius * .8
        spout = lathe('Spout with inner bore', [(radius * .24, 0), (radius * .16, length * .55), (radius * .12, length), (radius * .075, length), (radius * .09, length * .55), (radius * .15, wall)], 1, 1, base_mat, 32)
        spout.rotation_euler[1] = math.radians(55)
        spout.location = (radius * .73, 0, height * .47)
    if kind == 'ladle':
        tube_path('Long ladle handle', [(0, depth * .39, height * .70), (0, depth * .65, height * 1.1), (0, depth * 2.0, height * 2.1)], wall * 1.5, wood_mat)


def arch(name, center, y, bottom, span, rise, thickness, extrusion, mat=base_mat):
    vertices, faces = [], []
    steps = 16
    for j in range(steps + 1):
        angle = math.pi * j / steps
        for side in (-1, 1):
            for outer in (False, True):
                r = span / 2 + (thickness if outer else 0)
                z = rise + (thickness if outer else 0)
                vertices.append((center + math.cos(angle) * r, y + side * extrusion / 2, bottom + math.sin(angle) * z))
    for j in range(steps):
        a, b = j * 4, (j + 1) * 4
        faces.extend([(a, b, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2), (a, a + 2, b + 2, b), (a + 1, b + 1, b + 3, a + 3)])
    faces.extend([(0, 1, 3, 2), (steps * 4, steps * 4 + 2, steps * 4 + 3, steps * 4 + 1)])
    return mesh(name, vertices, [tuple(reversed(face)) for face in faces], mat)


def roof(z, w, d, rise):
    body_material = decorated_mat if kind == 'roof' else roof_mat
    if details['roof'] == 'flat':
        thickness = rise if kind == 'roof' else wall
        if kind == 'roof':
            box('Flat roof deck', 0, 0, z + (thickness - wall) / 2, w, d, thickness - wall, body_material)
            for sign in (-1, 1):
                box('Flat roof edge', sign * (w - wall) / 2, 0, z + thickness - wall / 2, wall, d, wall, accent_mat)
                box('Flat roof edge', 0, sign * (d - wall) / 2, z + thickness - wall / 2, w, wall, wall, accent_mat)
        else:
            box('Roof slab', 0, 0, z + thickness / 2, w, d, thickness, body_material)
        return
    vertices = [(-w / 2, -d / 2, z), (w / 2, -d / 2, z), (-w / 2, d / 2, z), (w / 2, d / 2, z), (-w / 2, 0, z + rise), (w / 2, 0, z + rise)]
    mesh('Pitched roof', vertices, [(0, 1, 5, 4), (2, 4, 5, 3), (0, 4, 2), (1, 3, 5), (0, 2, 3, 1)], body_material)
    tube_path('Ridge cap', [(-w / 2, 0, z + rise), (w / 2, 0, z + rise)], max(wall * .45, .012), accent_mat, 12)
    for index in range(17):
        x = -w / 2 + w * index / 16
        for side in (-1, 1):
            tube_path('Tile channel', [(x, side * d / 2, z + .005), (x, 0, z + rise + .005)], max(wall * .08, .004), body_material, 8)


def window_frame(cx, y, bottom, w, h, thickness, bars=4, extrusion=None):
    mat = decorated_mat if kind == 'window' or plan['decoration']['style'] != 'plain' else wood_mat
    extrusion = thickness if extrusion is None else extrusion
    for sign in (-1, 1):
        box('Window frame', cx + sign * (w - thickness) / 2, y, bottom + h / 2, thickness, extrusion, h, mat)
        box('Window frame', cx, y, bottom + (thickness / 2 if sign < 0 else h - thickness / 2), w, extrusion, thickness, mat)
    for j in range(1, bars):
        box('Window lattice vertical', cx - w / 2 + w * j / bars, y, bottom + h / 2, thickness * .42, extrusion * .65, h, accent_mat)
    for j in range(1, 4):
        box('Window lattice horizontal', cx, y, bottom + h * j / 4, w, extrusion * .65, thickness * .42, accent_mat)


def architecture():
    bays = details['bays']
    if kind == 'window':
        window_frame(0, 0, 0, width, height, wall, 6, depth)
        # A frame is a shallow standalone building element, not a sealed wall.
        return
    if kind == 'roof':
        roof(0, width, depth, height)
        return
    colonnade = kind == 'colonnade'
    stories = 1 if colonnade else details['stories']
    roof_height = height * .13 if details['roof'] == 'pitched' else wall
    level = (height - roof_height) / stories
    bay = width / bays
    pillar = min(bay * .12, level * .10)
    front = -depth * .40
    box('Foundation', 0, 0, wall / 2, width, depth, wall, roof_mat)
    for j in range(bays + 1):
        x = -width / 2 + pillar / 2 + (width - pillar) * j / bays
        box('Arcade column', x, front, level * .39, pillar, pillar, level * .78, decorated_mat)
        box('Column base', x, front, wall * 1.25, pillar * 1.35, pillar * 1.35, wall, accent_mat)
        box('Column capital', x, front, level * .74, pillar * 1.30, pillar * 1.30, pillar * .5, base_mat)
    for j in range(bays):
        cx = -width / 2 + bay * (j + .5)
        arch('Arcade arch', cx, front, level * .74, bay - pillar * 1.8, level * .20, pillar * .52, pillar, decorated_mat)
    box('Ground floor beam', 0, front, level * .98, width, pillar * 1.2, level * .08, accent_mat)
    if not colonnade:
        for storey in range(stories):
            z = storey * level
            box('Floor', 0, 0, z + wall / 2, width, depth, wall, base_mat)
            box('Rear wall', 0, depth * .46, z + level / 2, width, wall, level, base_mat)
            for side in (-1, 1):
                box('Side wall', side * (width - wall) / 2, depth * .08, z + level / 2, wall, depth * .78, level, base_mat)
            if storey > 0:
                box('Upper front wall', 0, front + wall, z + level / 2, width, wall, level, decorated_mat)
                for j in range(bays):
                    cx = -width / 2 + bay * (j + .5)
                    # Frames stand off a recessed dark panel; they are not exact surveyed openings.
                    box('Recessed window panel', cx, front - .015, z + level * .51, bay * .48, .012, level * .54, roof_mat)
                    window_frame(cx, front - wall * .24, z + level * .24, bay * .48, level * .54, max(wall * .22, .015), 3)
                box('Balcony sill', 0, front - pillar * .35, z + level * .11, width, pillar * 1.8, wall * .6, accent_mat)
            box('Horizontal cornice', 0, front - pillar * .15, z + level, width * 1.01, pillar * 1.25, wall * .8, base_mat)
    roof(height - roof_height, width * 1.04, depth * 1.05, roof_height)


if args.mode == 'build':
    if kind in ['arcade', 'window', 'colonnade', 'roof']:
        architecture()
    else:
        vessel()


def inspect_scene():
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not objects or len(objects) > 240 or any(obj.type != 'MESH' for obj in bpy.context.scene.objects):
        raise ValueError('Mesh object budget failed')
    vertices, triangles = 0, 0
    points = []
    for obj in objects:
        data = obj.data
        if data.validate(verbose=False):
            raise ValueError('Generated mesh required unexpected repair')
        data.calc_loop_triangles()
        vertices += len(data.vertices)
        triangles += len(data.loop_triangles)
        if not data.uv_layers or any(not math.isfinite(c) for vert in data.vertices for c in vert.co):
            raise ValueError('Missing UV map or invalid mesh coordinates')
        geometry = bmesh.new()
        try:
            geometry.from_mesh(data)
            if any(not edge.is_manifold for edge in geometry.edges):
                raise ValueError('Generated component has open or non-manifold edges: ' + obj.name)
            if geometry.calc_volume(signed=True) <= 0:
                raise ValueError('Generated component has reversed normals or no enclosed volume: ' + obj.name)
            if any(face.calc_area() <= 1e-14 for face in geometry.faces):
                raise ValueError('Generated component has degenerate faces: ' + obj.name)
        finally:
            geometry.free()
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if triangles > 40000 or triangles < 4:
        raise ValueError('Triangle budget failed')
    dims = [round(max(p[i] for p in points) - min(p[i] for p in points), 6) for i in range(3)]
    if any(not math.isfinite(v) or v <= 0 or v > 100 for v in dims):
        raise ValueError('Invalid model bounds')
    packed = all(image.packed_file is not None for image in bpy.data.images if image.type == 'IMAGE')
    if not packed:
        raise ValueError('Texture is not embedded in blend')
    return {'vertices': vertices, 'triangles': triangles, 'objects': len(objects), 'materials': len({slot.material.name for obj in objects for slot in obj.material_slots if slot.material}), 'dimensions': dims, 'unit': 'm'}


blend_path = os.path.join(root, 'asset.blend')
glb_path = os.path.join(root, 'asset.glb')
if args.mode == 'build':
    bpy.context.view_layer.update()
    before = inspect_scene()
    scene = bpy.context.scene
    scene['craft_plan_version'] = 1
    scene['craft_title'] = plan['title']
    scene['craft_recipe'] = kind
    scene['cultural_note'] = 'Original theme-inspired parametric design; not a surveyed heritage reconstruction.'
    # Plain .blend header supports independent validation; no .blend1 backup is made.
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=False, check_existing=False)
    with open(os.path.join(root, 'expected.json'), 'w', encoding='utf-8') as stream:
        json.dump(before, stream)
    print('WORKBENCH_CRAFT_SAVED')
else:
    # This branch always runs in a NEW protected Blender process after the builder
    # has exited. Export the exact reopened scene, not an in-memory approximation.
    bpy.ops.wm.open_mainfile(filepath=blend_path, load_ui=False, use_scripts=False)
    bpy.context.view_layer.update()
    after = inspect_scene()
    with open(os.path.join(root, 'expected.json'), 'r', encoding='utf-8') as stream:
        before = json.load(stream)
    if before != after:
        raise ValueError('Saved Blender scene differs from generated mesh')
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT', export_animations=False, export_cameras=False, export_lights=False, export_extras=False)
    with open(os.path.join(root, 'validation.json'), 'w', encoding='utf-8') as stream:
        json.dump({'reopened': True, 'packedTextures': True, 'stats': after}, stream, ensure_ascii=False)
    print('WORKBENCH_CRAFT_VALIDATED ' + json.dumps(after))
