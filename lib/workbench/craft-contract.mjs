// This contract intentionally contains no Node imports: the form and Runtime share it.
export const CRAFT_KINDS = Object.freeze(['bowl', 'plate', 'basin', 'vase', 'jar', 'pot', 'ladle', 'teapot', 'arcade', 'window', 'colonnade', 'roof']);
const labels = { bowl: '碗', plate: '盘', basin: '盆', vase: '花瓶', jar: '罐', pot: '锅', ladle: '瓢勺', teapot: '茶壶', arcade: '骑楼建筑', window: '花窗', colonnade: '柱廊', roof: '坡屋顶构件' };
export const craftKindLabel = kind => labels[kind] || '文创资产';
export const CRAFT_PARAMETER_RULES = `构造字段适用范围：bowl/plate/basin/vase/jar/pot/ladle/teapot 只使用 handles、lid、spout、profile；arcade 使用 stories(1..3)、bays(1..5)、roof；colonnade 使用 bays、roof，固定单层 stories=1；roof 只使用 roof；window 不使用 details 字段。不适用字段请省略，不可借这些字段表达未实现需求。规范化结果中的固定默认值仅为兼容占位，不是额外功能。\n窗格宽高10..500厘米，depth是窗框真实挤出厚度1..50厘米，默认8厘米；wallThickness是正面框条宽度。其它器具/建筑的尺寸是主体名义尺寸，盖、把手、嘴、屋檐等附属件可能超出主体尺寸。独立平屋顶的height代表整块厚度；器具不支持定制圈足、额外雕刻等schema外构造。`;
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
export const CRAFT_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind'], properties: {
    version: { type: 'integer', const: 1 }, title: { type: 'string', minLength: 1, maxLength: 80 },
    kind: { type: 'string', enum: [...CRAFT_KINDS] },
    dimensions: { type: 'object', additionalProperties: false, properties: { width: number(3, 2000), height: number(1, 1500), depth: number(1, 2000), wallThickness: number(0.1, 30) } },
    material: { type: 'object', additionalProperties: false, properties: { color, roughness: number(0, 1), metallic: number(0, 1) } },
    decoration: { type: 'object', additionalProperties: false, properties: { style: { enum: ['plain', 'floral', 'lattice'] }, color } },
    details: { type: 'object', additionalProperties: false, properties: {
      handles: { type: 'integer', minimum: 0, maximum: 2 }, lid: { type: 'boolean' }, spout: { type: 'boolean' },
      stories: { type: 'integer', minimum: 1, maximum: 3 }, bays: { type: 'integer', minimum: 1, maximum: 5 },
      roof: { enum: ['flat', 'pitched'] }, profile: { enum: ['round', 'tapered', 'flared'] },
    } },
  },
};
const defaults = {
  bowl: [16, 8, 16, 0.5], plate: [24, 3, 24, 0.4], basin: [36, 14, 36, 0.7],
  vase: [18, 32, 18, 0.6], jar: [22, 28, 22, 0.7], pot: [28, 16, 28, 0.8],
  ladle: [12, 5, 12, 0.4], teapot: [18, 16, 18, 0.6],
  arcade: [600, 720, 450, 15], window: [120, 160, 8, 5],
  colonnade: [600, 360, 200, 12], roof: [600, 160, 450, 10],
};
function object(value, allowed, name) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name}须为对象。`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${name}不支持字段 ${key}。`);
  return value;
}
function finite(value, fallback, low, high, name, integer = false) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < low || result > high || (integer && !Number.isInteger(result))) throw new TypeError(`${name}须在 ${low}–${high} 之间${integer ? '，并为整数' : ''}。`);
  return result;
}
function choice(value, fallback, options, name) {
  if (value === undefined) return fallback;
  if (!options.includes(value)) throw new TypeError(`${name}不支持该选项。`);
  return value;
}
function hex(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('颜色须为 #RRGGBB。');
  return value.toLowerCase();
}
export function normalizeCraftPlan(input) {
  const value = object(input, Object.keys(CRAFT_PLAN_SCHEMA.properties), '建模方案');
  if (!CRAFT_KINDS.includes(value.kind)) throw new TypeError('请选择目前支持的器具或建筑构件。');
  if (value.version !== undefined && value.version !== 1) throw new TypeError('不支持该建模方案版本。');
  const title = value.title === undefined ? craftKindLabel(value.kind) : value.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 80 || Array.from(title).some(char => char.charCodeAt(0) < 32)) throw new TypeError('资产名称须为 1–80 个可显示字符。');
  const building = ['arcade', 'window', 'colonnade', 'roof'].includes(value.kind);
  const window = value.kind === 'window';
  const d = object(value.dimensions, ['width', 'height', 'depth', 'wallThickness'], '尺寸');
  const base = defaults[value.kind];
  const dimensions = {
    width: finite(d.width, base[0], window ? 10 : building ? 50 : 3, window ? 500 : building ? 2000 : 100, '宽度'),
    height: finite(d.height, base[1], window ? 10 : building ? 30 : 1, window ? 500 : building ? 1500 : 150, '高度'),
    depth: finite(d.depth, base[2], window ? 1 : building ? 50 : 3, window ? 50 : building ? 2000 : 100, '深度'),
  };
  const shortest = window ? Math.min(dimensions.width, dimensions.height) : Math.min(dimensions.width, dimensions.height, dimensions.depth);
  dimensions.wallThickness = finite(d.wallThickness, Math.max(.1, Math.min(base[3], shortest / 8)), .1, 30, '壁厚');
  if (dimensions.wallThickness >= shortest / 4) throw new TypeError(window ? '窗框正面条宽须小于宽、高中最短尺寸的四分之一。' : '壁厚须小于宽、高、深中最短尺寸的四分之一。');
  const m = object(value.material, ['color', 'roughness', 'metallic'], '材质');
  const decoration = object(value.decoration, ['style', 'color'], '纹饰');
  const details = object(value.details, ['handles', 'lid', 'spout', 'stories', 'bays', 'roof', 'profile'], '构造');
  for (const key of ['lid', 'spout']) if (details[key] !== undefined && typeof details[key] !== 'boolean') throw new TypeError(`${key}须为布尔值。`);
  // Preserve the complete canonical object accepted by existing saved plans.
  // Irrelevant fields may retain their old canonical defaults, but can never
  // carry an unsupported customization that the renderer would silently ignore.
  const applicable = !building ? ['handles', 'lid', 'spout', 'profile'] : value.kind === 'arcade' ? ['stories', 'bays', 'roof'] : value.kind === 'colonnade' ? ['bays', 'roof'] : value.kind === 'roof' ? ['roof'] : [];
  const inactiveDefaults = { handles: 0, lid: false, spout: false, stories: 1, bays: 3, roof: 'pitched', profile: 'round' };
  for (const [key, val] of Object.entries(details)) if (!applicable.includes(key) && val !== inactiveDefaults[key]) throw new TypeError(`${craftKindLabel(value.kind)}不支持设置 ${key}；请省略此字段，不会用其它外形代替该要求。`);
  return {
    version: 1, title: title.trim(), kind: value.kind, dimensions,
    material: { color: hex(m.color, building ? '#e5d8bc' : '#e6eee4'), roughness: finite(m.roughness, building ? 0.78 : 0.24, 0, 1, '粗糙度'), metallic: finite(m.metallic, value.kind === 'pot' ? 0.6 : 0, 0, 1, '金属度') },
    decoration: { style: choice(decoration.style, 'plain', ['plain', 'floral', 'lattice'], '纹饰'), color: hex(decoration.color, building ? '#476653' : '#315f7b') },
    details: {
      handles: finite(details.handles, value.kind === 'pot' ? 2 : value.kind === 'teapot' ? 1 : 0, 0, 2, '提柄数', true),
      lid: details.lid ?? ['pot', 'teapot'].includes(value.kind), spout: details.spout ?? value.kind === 'teapot',
      stories: finite(details.stories, value.kind === 'arcade' ? 2 : 1, 1, 3, '层数', true), bays: finite(details.bays, 3, 1, 5, '开间数', true),
      roof: choice(details.roof, 'pitched', ['flat', 'pitched'], '屋顶'), profile: choice(details.profile, 'round', ['round', 'tapered', 'flared'], '轮廓'),
    },
  };
}
