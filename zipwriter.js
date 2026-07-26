// Minimal ZIP writer — STORE (no compression) method, good enough for .mcpack/.mcaddon.
// No dependencies. Works fully client-side.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function strToBytes(str) {
  return new TextEncoder().encode(str);
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { time, dosDate };
}

class ZipWriter {
  constructor() {
    this.files = []; // { nameBytes, dataBytes, crc, offset }
    this.chunks = [];
    this.offset = 0;
  }

  _push(uint8) {
    this.chunks.push(uint8);
    this.offset += uint8.length;
  }

  addFile(path, data) {
    const nameBytes = strToBytes(path.replace(/\\/g, "/"));
    const dataBytes = data instanceof Uint8Array ? data : strToBytes(data);
    const crc = crc32(dataBytes);
    const { time, dosDate } = dosDateTime(new Date());
    const localOffset = this.offset;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method = store
    local.setUint16(10, time, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dataBytes.length, true); // compressed size
    local.setUint32(22, dataBytes.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra len

    this._push(new Uint8Array(local.buffer));
    this._push(nameBytes);
    this._push(dataBytes);

    this.files.push({ nameBytes, size: dataBytes.length, crc, offset: localOffset, time, dosDate });
  }

  addFolder(path) {
    // Not strictly required in zip files (folders are implicit), skip.
  }

  generate() {
    const centralStart = this.offset;
    for (const f of this.files) {
      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true); // version made by
      central.setUint16(6, 20, true); // version needed
      central.setUint16(8, 0, true); // flags
      central.setUint16(10, 0, true); // method
      central.setUint16(12, f.time, true);
      central.setUint16(14, f.dosDate, true);
      central.setUint32(16, f.crc, true);
      central.setUint32(20, f.size, true);
      central.setUint32(24, f.size, true);
      central.setUint16(28, f.nameBytes.length, true);
      central.setUint16(30, 0, true); // extra len
      central.setUint16(32, 0, true); // comment len
      central.setUint16(34, 0, true); // disk number start
      central.setUint16(36, 0, true); // internal attrs
      central.setUint32(38, 0, true); // external attrs
      central.setUint32(42, f.offset, true);

      this._push(new Uint8Array(central.buffer));
      this._push(f.nameBytes);
    }
    const centralSize = this.offset - centralStart;

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, this.files.length, true);
    end.setUint16(10, this.files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralStart, true);
    end.setUint16(20, 0, true);
    this._push(new Uint8Array(end.buffer));

    const total = new Uint8Array(this.offset);
    let pos = 0;
    for (const chunk of this.chunks) {
      total.set(chunk, pos);
      pos += chunk.length;
    }
    return total;
  }
}
