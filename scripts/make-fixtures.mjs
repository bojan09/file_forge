// Generates binary and large test fixtures into tests/fixtures (committed small ones; large ones are git-ignored).
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const dir = "tests/fixtures";
mkdirSync(dir, { recursive: true });
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

async function canvasImage(w, h, mime, q) {
  const b64 = await page.evaluate(
    async ([w, h, mime, q]) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#4f46e5");
      grad.addColorStop(1, "#22d3ee");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#fff";
      g.font = "bold 28px sans-serif";
      g.fillText("TOP-LEFT", 10, 36);
      g.fillStyle = "#f59e0b";
      g.fillRect(w - 60, h - 60, 50, 50);
      const blob = await new Promise((r) => c.toBlob(r, mime, q));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    [w, h, mime, q],
  );
  return Buffer.from(b64, "base64");
}

/** Inserts an EXIF APP1 segment with the given orientation right after the JPEG SOI marker. */
function withOrientation(jpeg, orientation) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const len = exif.length + 2;
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 255]), exif]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

const jpg = await canvasImage(400, 240, "image/jpeg", 0.9);
writeFileSync(`${dir}/photo.jpg`, jpg);
// Stored as 400x240 landscape with orientation 6 (rotate 90 CW) => displays as 240x400 portrait.
writeFileSync(`${dir}/rotated.jpg`, withOrientation(jpg, 6));
writeFileSync(`${dir}/image.png`, await canvasImage(320, 200, "image/png"));
writeFileSync(`${dir}/image.webp`, await canvasImage(300, 300, "image/webp", 0.9));

// Declares 20000x20000 (400 MP) in the PNG header: must be rejected from the header alone.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(20000, 0);
ihdr.writeUInt32BE(20000, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(`${dir}/huge-dimensions.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(10))), chunk("IEND", Buffer.alloc(0))]));
await browser.close();
console.log("fixtures written");
