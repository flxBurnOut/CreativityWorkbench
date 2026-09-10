// Basic format checks at the storage boundary. Actual scene validation is done
// by Blender before these files are published as a completed asset.
// Blender's format-0 header is 12 bytes; format-1 (5.0+) is 17 bytes.
// https://github.com/blender/blender/blob/main/source/blender/blenloader_core/BLO_core_blend_header.hh
export const CRAFT_HEADER_BYTES=17;
export function validCraftFileHeader(header,extension,size) {
  if(!header||header.length<12||!Number.isSafeInteger(size)||size<12)return false;
  if(extension==='blend') {
    const legacy=Buffer.from(header.subarray(0,12)).toString('latin1');
    if(/^BLENDER[_-][vV]\d{3}$/.test(legacy))return true;
    if(header.length<CRAFT_HEADER_BYTES||size<CRAFT_HEADER_BYTES)return false;
    return /^BLENDER17-01v\d{4}$/.test(Buffer.from(header.subarray(0,CRAFT_HEADER_BYTES)).toString('latin1'));
  }
  if(extension==='glb') {
    const bytes=Buffer.from(header.subarray(0,12));
    return bytes.toString('latin1',0,4)==='glTF'&&bytes.readUInt32LE(4)===2&&bytes.readUInt32LE(8)===size;
  }
  return false;
}
