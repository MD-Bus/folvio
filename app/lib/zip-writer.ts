/**
 * A streaming ZIP writer for the browser. Entries are stored (no compression: photos, videos and archives do not
 * shrink, and storing keeps it fast) with UTF-8 names, and each file's CRC-32 is computed while its bytes stream
 * through, so nothing is held in memory but the current chunk. Plain ZIP: up to 4 GiB and 65,535 entries.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

/** MS-DOS date and time, as ZIP stores them (local time, 2-second precision, 1980 at the earliest). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

export type ZipSink = { write: (chunk: Uint8Array) => Promise<void> | void; close: () => Promise<void> | void }

type Central = { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number; directory: boolean }

const LIMIT = 0xffffffff
const FLAGS = 0x0808 // bit 3: sizes and CRC follow the data; bit 11: names are UTF-8

export class ZipWriter {
  private offset = 0
  private entries: Central[] = []
  private encoder = new TextEncoder()

  constructor(private sink: ZipSink) {}

  private async out(bytes: Uint8Array) {
    if (this.offset + bytes.byteLength > LIMIT) throw new Error("The archive would exceed 4 GB.")
    await this.sink.write(bytes)
    this.offset += bytes.byteLength
  }

  private header(name: Uint8Array, at: Date): { bytes: Uint8Array; time: number; date: number } {
    const { time, date } = dosDateTime(at)
    const bytes = new Uint8Array(30 + name.byteLength)
    const v = new DataView(bytes.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, FLAGS, true)
    v.setUint16(8, 0, true) // stored
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    // CRC and sizes (14-25) are 0 here and given in the data descriptor.
    v.setUint16(26, name.byteLength, true)
    bytes.set(name, 30)
    return { bytes, time, date }
  }

  /** A folder entry, so empty folders survive. `path` ends with "/". */
  async addDirectory(path: string, at = new Date()) {
    const name = this.encoder.encode(path.endsWith("/") ? path : `${path}/`)
    const offset = this.offset
    const h = this.header(name, at)
    await this.out(h.bytes)
    await this.out(descriptor(0, 0))
    this.entries.push({ name, crc: 0, size: 0, offset, time: h.time, date: h.date, directory: true })
  }

  /** A file entry from a stream of its bytes. Returns its size. */
  async addFile(path: string, body: ReadableStream<Uint8Array>, at = new Date(), onBytes?: (n: number) => void): Promise<number> {
    const name = this.encoder.encode(path)
    const offset = this.offset
    const h = this.header(name, at)
    await this.out(h.bytes)
    let crc = 0
    let size = 0
    const reader = body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      crc = crc32(value, crc)
      size += value.byteLength
      await this.out(value)
      onBytes?.(value.byteLength)
    }
    await this.out(descriptor(crc, size))
    this.entries.push({ name, crc, size, offset, time: h.time, date: h.date, directory: false })
    return size
  }

  /** Writes the central directory and closes the sink. */
  async finish() {
    if (this.entries.length > 0xffff) throw new Error("The archive would have more than 65,535 entries.")
    const start = this.offset
    for (const e of this.entries) {
      const bytes = new Uint8Array(46 + e.name.byteLength)
      const v = new DataView(bytes.buffer)
      v.setUint32(0, 0x02014b50, true)
      v.setUint16(4, 20, true) // made by: MS-DOS attributes
      v.setUint16(6, 20, true)
      v.setUint16(8, FLAGS, true)
      v.setUint16(10, 0, true)
      v.setUint16(12, e.time, true)
      v.setUint16(14, e.date, true)
      v.setUint32(16, e.crc, true)
      v.setUint32(20, e.size, true)
      v.setUint32(24, e.size, true)
      v.setUint16(28, e.name.byteLength, true)
      v.setUint32(38, e.directory ? 0x10 : 0, true)
      v.setUint32(42, e.offset, true)
      bytes.set(e.name, 46)
      await this.out(bytes)
    }
    const end = new Uint8Array(22)
    const v = new DataView(end.buffer)
    v.setUint32(0, 0x06054b50, true)
    v.setUint16(8, this.entries.length, true)
    v.setUint16(10, this.entries.length, true)
    v.setUint32(12, this.offset - start, true)
    v.setUint32(16, start, true)
    await this.out(end)
    await this.sink.close()
  }
}

function descriptor(crc: number, size: number): Uint8Array {
  const bytes = new Uint8Array(16)
  const v = new DataView(bytes.buffer)
  v.setUint32(0, 0x08074b50, true)
  v.setUint32(4, crc, true)
  v.setUint32(8, size, true)
  v.setUint32(12, size, true)
  return bytes
}
