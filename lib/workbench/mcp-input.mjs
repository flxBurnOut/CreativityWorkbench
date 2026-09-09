import { z } from 'zod';

const MAX_ARRAY_JSON = 2 * 1024 * 1024;
// Only the MCP transport accepts encoded arrays. Runtime contracts remain strict.
export function mcpInputSchema(schema) {
  const def=schema._def;
  const clone=patch=>new schema.constructor({...def,...patch});
  if(def.typeName==='ZodArray') {
    const array=clone({type:mcpInputSchema(def.type)});
    const encoded=z.string().max(MAX_ARRAY_JSON).describe('客户端不能传数组时，可传完整 JSON 数组字符串；不接受逗号分隔文本。').transform((value,ctx)=>{
      let parsed;
      try { parsed=JSON.parse(value); } catch { ctx.addIssue({code:'custom',message:'需要有效的 JSON 数组字符串。'});return z.NEVER; }
      const result=array.safeParse(parsed);
      if(!result.success){for(const issue of result.error.issues)ctx.addIssue(issue);return z.NEVER;}
      return result.data;
    });
    return z.union([array,encoded]).describe(schema.description||'数组；兼容 JSON 数组字符串。');
  }
  if(def.typeName==='ZodObject')return clone({shape:()=>Object.fromEntries(Object.entries(schema.shape).map(([key,value])=>[key,mcpInputSchema(value)]))});
  if(['ZodOptional','ZodNullable','ZodDefault'].includes(def.typeName))return clone({innerType:mcpInputSchema(def.innerType)});
  if(def.typeName==='ZodEffects')return clone({schema:mcpInputSchema(def.schema)});
  return schema;
}
