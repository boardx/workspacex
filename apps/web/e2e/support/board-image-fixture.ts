import {deflateSync} from 'node:zlib';

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);

function pngChunk(name:string,data:Buffer){
  const body=Buffer.concat([Buffer.from(name),data]);
  let crc=0xffffffff;
  for(const byte of body){
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  const size=Buffer.alloc(4),checksum=Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,body,checksum]);
}

/** A real, decodable 64 x 48 RGB PNG used by browser image acceptance tests. */
export function boardImagePngFixture(){
  const header=Buffer.alloc(13);
  header.writeUInt32BE(64,0);
  header.writeUInt32BE(48,4);
  header[8]=8;
  header[9]=2;
  const pixels=Buffer.alloc(48*193);
  for(let y=0;y<48;y++)for(let x=0;x<64;x++){
    const offset=y*193+1+x*3;
    pixels[offset]=231;
    pixels[offset+1]=29;
    pixels[offset+2]=73;
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR',header),
    pngChunk('IDAT',deflateSync(pixels)),
    pngChunk('IEND',Buffer.alloc(0)),
  ]);
}
