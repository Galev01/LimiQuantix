#!/usr/bin/env node

/**
 * Generate placeholder icon files for QVMRC
 * 
 * For production, use `npm run tauri:icon` with a proper 1024x1024 PNG image.
 * This script creates minimal placeholder icons for development/testing.
 * 
 * Usage:
 *   node scripts/generate-icons.cjs
 * 
 * For proper icons:
 *   1. Create a 1024x1024 PNG named "app-icon.png" in qvmrc/
 *   2. Run: npm run tauri:icon
 */

const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create a simple valid PNG with solid color
function createSolidPNG(size) {
  // This creates a minimal valid PNG
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData.writeUInt8(8, 8);        // bit depth
  ihdrData.writeUInt8(2, 9);        // color type (RGB)
  ihdrData.writeUInt8(0, 10);       // compression
  ihdrData.writeUInt8(0, 11);       // filter
  ihdrData.writeUInt8(0, 12);       // interlace
  
  const ihdrCRC = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdrChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 13]),     // length
    Buffer.from('IHDR'),
    ihdrData,
    ihdrCRC
  ]);
  
  // Create raw image data (purple color)
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < size; x++) {
      rawData.push(0x93, 0x33, 0xEA); // RGB for purple (#9333ea)
    }
  }
  
  // Compress with zlib
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  
  const idatCRC = crc32(Buffer.concat([Buffer.from('IDAT'), compressed]));
  const idatLenBuf = Buffer.alloc(4);
  idatLenBuf.writeUInt32BE(compressed.length, 0);
  
  const idatChunk = Buffer.concat([
    idatLenBuf,
    Buffer.from('IDAT'),
    compressed,
    idatCRC
  ]);
  
  // IEND chunk
  const iendCRC = crc32(Buffer.from('IEND'));
  const iendChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'),
    iendCRC
  ]);
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Simple CRC32 implementation for PNG
function crc32(data) {
  let crc = 0xFFFFFFFF;
  const table = [];
  
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  
  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 0);
  return result;
}

// Create a minimal ICO file (Windows icon)
function createICO(pngData) {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: 1 = ICO
  header.writeUInt16LE(1, 4);     // Number of images
  
  // Image directory entry
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);         // Width (0 = 256)
  entry.writeUInt8(0, 1);         // Height (0 = 256)
  entry.writeUInt8(0, 2);         // Color palette
  entry.writeUInt8(0, 3);         // Reserved
  entry.writeUInt16LE(1, 4);      // Color planes
  entry.writeUInt16LE(32, 6);     // Bits per pixel
  entry.writeUInt32LE(pngData.length, 8);  // Size of image data
  entry.writeUInt32LE(22, 12);    // Offset to image data (6 + 16)
  
  return Buffer.concat([header, entry, pngData]);
}

// Create minimal ICNS (macOS icon bundle)
function createICNS(pngData) {
  // ICNS header
  const magic = Buffer.from('icns');
  
  // ic07 = 128x128 PNG
  const iconType = Buffer.from('ic07');
  const iconDataLen = Buffer.alloc(4);
  iconDataLen.writeUInt32BE(8 + pngData.length, 0);
  
  const totalLen = Buffer.alloc(4);
  totalLen.writeUInt32BE(8 + 8 + pngData.length, 0);
  
  return Buffer.concat([magic, totalLen, iconType, iconDataLen, pngData]);
}

console.log('Generating icons for QVMRC...');
console.log('Icons directory:', iconsDir);
console.log('');

// Generate PNGs
const pngSizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

pngSizes.forEach(({ name, size }) => {
  const filepath = path.join(iconsDir, name);
  const pngData = createSolidPNG(size);
  fs.writeFileSync(filepath, pngData);
  console.log(`✓ Created ${name} (${size}x${size})`);
});

// Generate ICO using 256x256 PNG
const ico256 = createSolidPNG(256);
const icoPath = path.join(iconsDir, 'icon.ico');
fs.writeFileSync(icoPath, createICO(ico256));
console.log('✓ Created icon.ico');

// Generate ICNS using 128x128 PNG
const png128 = createSolidPNG(128);
const icnsPath = path.join(iconsDir, 'icon.icns');
fs.writeFileSync(icnsPath, createICNS(png128));
console.log('✓ Created icon.icns');

console.log('');
console.log('✅ Icons generated successfully!');
console.log('');
console.log('The icons are solid purple (#9333EA) placeholders.');
console.log('For a custom icon, create app-icon.png (1024x1024) and run:');
console.log('  npm run tauri:icon');
console.log('');
console.log('Next steps:');
console.log('  cd qvmrc');
console.log('  npm install');
console.log('  npm run tauri:build');
