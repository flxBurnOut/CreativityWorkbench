export const MAX_GLB_BYTES = 32 * 1024 * 1024;

export function craftModelPath(fileId) {
  if (!/^[a-f0-9]{64}\.glb$/.test(fileId)) throw new Error('模型文件地址无效，请重新读取项目。');
  return '/api/workbench/data/files/' + fileId;
}

/** Stream into a bounded buffer rather than trusting Content-Length. */
export async function readModelResponse(response, signal, limit = MAX_GLB_BYTES) {
  if (!response.ok) throw new Error('模型读取失败，请重试预览；已有文件仍可下载。');
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > limit) { await response.body?.cancel(); throw new Error('模型超过网页预览的 32 MB 上限，请下载 Blender 文件查看。'); }
  if (!response.body) throw new Error('模型响应为空。');
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(limit, Math.max(65536, declared))), length = 0, complete = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      signal?.throwIfAborted();
      if (done) { complete = true; break; }
      if (length + value.byteLength > limit) throw new Error('模型超过网页预览的 32 MB 上限，请下载 Blender 文件查看。');
      if (length + value.byteLength > buffer.byteLength) {
        const expanded = new Uint8Array(Math.min(limit, Math.max(length + value.byteLength, buffer.byteLength * 2)));
        expanded.set(buffer.subarray(0, length)); buffer = expanded;
      }
      buffer.set(value, length); length += value.byteLength;
    }
    return buffer.buffer.slice(0, length);
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** GLB stays self contained. Do not let the loader fetch unbounded remote data. */
export function validatePreviewGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > MAX_GLB_BYTES) throw new Error('模型文件大小或格式无效。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('模型不是完整的 GLB 2.0 文件。');
  const size = view.getUint32(12, true);
  if (size > 1024 * 1024 || size % 4 || size + 28 > buffer.byteLength) throw new Error('模型结构说明过大或损坏。');
  let data;
  try { data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, size))); }
  catch { throw new Error('模型结构无法读取。'); }
  if (data?.asset?.version !== '2.0') throw new Error('模型版本无法预览。');
  const supportedExtensions = new Set(['KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_sheen', 'KHR_materials_emissive_strength', 'KHR_texture_transform']);
  const pending = [data]; let visited = 0;
  while (pending.length) {
    if (++visited > 200000) throw new Error('模型结构过于复杂，建议下载查看。');
    const item = pending.pop();
    if (item && typeof item === 'object') for (const [key, value] of Object.entries(item)) {
      if (key === 'uri') throw new Error('网页仅预览自包含模型；这份文件还引用了外部资源。');
      if (key === 'extensions' && (!value || typeof value !== 'object' || Object.keys(value).some(name => !supportedExtensions.has(name)))) throw new Error('模型使用了本工作台预览不支持的扩展。');
      if (value && typeof value === 'object') pending.push(value);
    }
  }
  validateGeneratedMesh(data, view, size + 20);
  return data;
}

/** Only the bounded static mesh subset emitted by our Blender exporter. File
 * size alone is insufficient: sparse/empty accessors can allocate gigabytes. */
function validateGeneratedMesh(data, binary, chunkOffset) {
  const fail = message => { throw new Error('模型预览校验未通过：' + message + '。文件仍可下载。'); };
  const integer = (value, maximum, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  const list = (name, maximum, minimum = 0) => {
    const values = data[name] ?? [];
    if (!Array.isArray(values) || values.length < minimum || values.length > maximum) fail(name + ' 数量超过预览范围');
    return values;
  };
  const buffers = list('buffers', 1, 1), views = list('bufferViews', 2048, 1), accessors = list('accessors', 2048, 1);
  const meshes = list('meshes', 240, 1), nodes = list('nodes', 512, 1), scenes = list('scenes', 1, 1);
  const images = list('images', 8), textures = list('textures', 16), materials = list('materials', 32), samplers = list('samplers', 16);
  for (const name of ['skins', 'animations', 'cameras']) if (list(name, 0).length) fail('仅支持静态网格');
  const binSize = binary.getUint32(chunkOffset, true), binStart = chunkOffset + 8;
  if (binary.getUint32(chunkOffset + 4, true) !== 0x004e4942 || binSize % 4 || binStart + binSize !== binary.byteLength || !integer(buffers[0]?.byteLength, binSize, 1) || binSize - buffers[0].byteLength > 3) fail('二进制内容长度无效');
  let viewBytes = 0;
  for (const item of views) {
    if (!item || item.buffer !== 0 || !integer(item.byteOffset ?? 0, buffers[0].byteLength) || !integer(item.byteLength, buffers[0].byteLength, 1) || (item.byteOffset || 0) + item.byteLength > buffers[0].byteLength || item.byteStride !== undefined && (!integer(item.byteStride, 252, 4) || item.byteStride % 4)) fail('缓冲区访问越界');
    viewBytes += item.byteLength;
    if (viewBytes > MAX_GLB_BYTES) fail('缓冲区解码预算超限');
  }
  const componentBytes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}, components = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
  let accessorBytes = 0;
  const decodedBytes = [];
  for (const item of accessors) {
    if (!item || item.sparse !== undefined || !integer(item.bufferView, views.length - 1) || !integer(item.count, 120000, 1) || !componentBytes[item.componentType] || !components[item.type]) fail('accessor 必须引用有界的实际网格缓冲区');
    const source = views[item.bufferView], unit = componentBytes[item.componentType], element = unit * components[item.type], offset = item.byteOffset || 0, stride = source.byteStride || element;
    if (!integer(item.byteOffset ?? 0, source.byteLength) || offset % unit || ((source.byteOffset || 0) + offset) % unit || stride < element || offset + (item.count - 1) * stride + element > source.byteLength) fail('accessor 访问越界');
    // Allow for conversion into float attributes, not only packed source bytes.
    const decoded = item.count * components[item.type] * 4;
    decodedBytes.push(decoded); accessorBytes += decoded;
    if (accessorBytes > MAX_GLB_BYTES) fail('累计网格解码预算超限');
  }
  let pixels = 0;
  const imagePixels = [];
  for (const image of images) {
    if (!image || image.mimeType !== 'image/png' || !integer(image.bufferView, views.length - 1)) fail('纹理必须是内嵌 PNG');
    const source = views[image.bufferView], offset = binStart + (source.byteOffset || 0);
    if (source.byteLength < 33 || binary.getUint32(offset) !== 0x89504e47 || binary.getUint32(offset + 4) !== 0x0d0a1a0a || binary.getUint32(offset + 8) !== 13 || binary.getUint32(offset + 12) !== 0x49484452) fail('PNG 纹理头无效');
    const width = binary.getUint32(offset + 16), height = binary.getUint32(offset + 20);
    if (!integer(width, 1024, 1) || !integer(height, 1024, 1) || binary.getUint8(offset + 24) !== 8) fail('纹理尺寸或位深超出预览范围');
    pixels += width * height;
    imagePixels.push(width * height);
    if (pixels > 4 * 1024 * 1024) fail('累计纹理解码预算超限');
  }
  let texturePixels = 0;
  for (const texture of textures) {
    if (!texture || !integer(texture.source, images.length - 1) || texture.sampler !== undefined && !integer(texture.sampler, samplers.length - 1)) fail('纹理引用无效');
    texturePixels += imagePixels[texture.source];
    if (texturePixels > 4 * 1024 * 1024) fail('累计纹理实例解码预算超限');
  }
  let primitiveCount = 0, geometryBytes = 0;
  const meshStats = meshes.map(mesh => {
    if (!mesh || !Array.isArray(mesh.primitives) || !mesh.primitives.length || mesh.primitives.length > 8 || mesh.weights !== undefined) fail('仅支持有界的静态网格');
    let triangles = 0, bytes = 0;
    for (const primitive of mesh.primitives) {
      if (++primitiveCount > 480 || !primitive || primitive.mode !== undefined && primitive.mode !== 4 || primitive.targets !== undefined || !primitive.attributes || !integer(primitive.indices, accessors.length - 1) || primitive.material !== undefined && !integer(primitive.material, materials.length - 1)) fail('网格片段超出预览范围');
      const index = accessors[primitive.indices];
      if (index.type !== 'SCALAR' || ![5121, 5123, 5125].includes(index.componentType) || index.count % 3) fail('三角面索引无效');
      const position = accessors[primitive.attributes.POSITION];
      if (!position || position.type !== 'VEC3' || position.componentType !== 5126) fail('网格坐标无效');
      bytes += decodedBytes[primitive.indices]; triangles += index.count / 3;
      for (const [name, reference] of Object.entries(primitive.attributes)) {
        if (!['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0'].includes(name) || !integer(reference, accessors.length - 1) || accessors[reference].count !== position.count) fail('网格属性不在本生成器范围内');
        bytes += decodedBytes[reference];
      }
    }
    geometryBytes += bytes;
    if (geometryBytes > MAX_GLB_BYTES) fail('累计网格实例解码预算超限');
    return {triangles, bytes};
  });
  let objectCount = 0, renderedTriangles = 0, renderedBytes = 0;
  const parents = new Set(), visiting = new Set();
  const visit = (index, depth) => {
    if (!integer(index, nodes.length - 1) || parents.has(index) || visiting.has(index) || depth > 32) fail('模型节点重复、循环或层级过深');
    parents.add(index); visiting.add(index);
    const node = nodes[index];
    if (!node || node.skin !== undefined || node.camera !== undefined || node.weights !== undefined) fail('节点必须为静态网格');
    if (node.mesh !== undefined) {
      if (!integer(node.mesh, meshes.length - 1) || ++objectCount > 240) fail('网格对象数量超限');
      renderedTriangles += meshStats[node.mesh].triangles; renderedBytes += meshStats[node.mesh].bytes;
      if (renderedTriangles > 40000 || renderedBytes > MAX_GLB_BYTES) fail('累计场景解码预算超限');
    }
    if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > 512)) fail('子节点无效');
    for (const child of node.children || []) visit(child, depth + 1);
    visiting.delete(index);
  };
  if (data.scene !== undefined && data.scene !== 0 || !Array.isArray(scenes[0]?.nodes) || scenes[0].nodes.length > 512) fail('场景引用无效');
  for (const node of scenes[0].nodes) visit(node, 0);
  if (objectCount < 1) fail('场景没有网格对象');
}

/** Shared geometries, materials, textures and decoded bitmaps are released once. */
export function disposeModel(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material);
    if (node.skeleton?.boneTexture) textures.add(node.skeleton.boneTexture);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms || {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
  }
  for (const texture of textures) {
    const source = texture.source?.data || texture.image;
    for (const image of Array.isArray(source) ? source : [source]) if (image && typeof image.close === 'function') images.add(image);
    texture.dispose();
  }
  for (const image of images) image.close();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

/** One visible frame at a time; opt-in animation is capped at 30 rendered FPS. */
export function createDemandRender(render, requestFrame, cancelFrame, advance) {
  let frame = null, visible = true, disposed = false, animated = false, lastTime = null, epoch = 0;
  const cancel = () => { epoch++; if (frame !== null) cancelFrame(frame); frame = null; lastTime = null; };
  const request = () => {
    if (!disposed && visible && frame === null) {
      const scheduledEpoch = epoch;
      frame = requestFrame(time => {
        if (disposed || !visible || scheduledEpoch !== epoch) return;
        frame = null;
        if (animated) {
          const now = Number.isFinite(time) ? time : 0;
          if (lastTime !== null && now >= lastTime && now - lastTime < 1000 / 30 - 0.1) { request(); return; }
          advance(lastTime === null ? 0 : Math.max(0, Math.min((now - lastTime) / 1000, 0.1)));
          lastTime = now;
        }
        render();
        if (animated) request();
      });
    }
  };
  return {
    request,
    animate(value) { const next = Boolean(value && advance); if (next === animated || disposed) return; animated = next; cancel(); request(); },
    visible(value) { if (visible !== value) cancel(); visible = value; if (value) request(); },
    dispose() { disposed = true; animated = false; cancel(); },
  };
}
