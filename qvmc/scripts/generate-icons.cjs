#!/usr/bin/env node

/**
 * Generate icon files for qvmc from source PNG
 * 
 * This script uses the 32x32 source icon and generates all required sizes.
 * For best quality, provide a 1024x1024 source and use `npm run tauri:icon`.
 * 
 * Usage:
 *   node scripts/generate-icons.cjs
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
const sourceIcon = path.join(__dirname, '..', '..', 'frontend', 'src', 'assets', 'qvmc.png');

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('Generating icons for qvmc...');
console.log('Source icon:', sourceIcon);
console.log('Icons directory:', iconsDir);
console.log('');

// Read source PNG if it exists
let sourcePNG = null;
if (fs.existsSync(sourceIcon)) {
  sourcePNG = fs.readFileSync(sourceIcon);
  console.log('✓ Found source icon: qvmc.png');
} else {
  console.log('⚠ Source icon not found, will create placeholders');
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

// Create a simple valid PNG with solid color (fallback)
function createSolidPNG(size) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData.writeUInt8(8, 8);
  ihdrData.writeUInt8(2, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  
  const ihdrCRC = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdrChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    ihdrData,
    ihdrCRC
  ]);
  
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0);
    for (let x = 0; x < size; x++) {
      rawData.push(0x93, 0x33, 0xEA);
    }
  }
  
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
  
  const iendCRC = crc32(Buffer.from('IEND'));
  const iendChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'),
    iendCRC
  ]);
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Create ICO file from PNG data
function createICO(pngData) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngData.length, 8);
  entry.writeUInt32LE(22, 12);
  
  return Buffer.concat([header, entry, pngData]);
}

// Create ICNS file from PNG data
function createICNS(pngData) {
  const magic = Buffer.from('icns');
  const iconType = Buffer.from('ic07');
  const iconDataLen = Buffer.alloc(4);
  iconDataLen.writeUInt32BE(8 + pngData.length, 0);
  
  const totalLen = Buffer.alloc(4);
  totalLen.writeUInt32BE(8 + 8 + pngData.length, 0);
  
  return Buffer.concat([magic, totalLen, iconType, iconDataLen, pngData]);
}

// Copy source to 32x32 if we have it
if (sourcePNG) {
  const dest32 = path.join(iconsDir, '32x32.png');
  fs.writeFileSync(dest32, sourcePNG);
  console.log('✓ Copied source to 32x32.png');
  
  // For other sizes, we'll use the 32x32 source directly
  // (Not ideal, but works - Tauri will scale as needed)
  const dest128 = path.join(iconsDir, '128x128.png');
  const dest256 = path.join(iconsDir, '128x128@2x.png');
  
  // Copy source to other locations (Tauri accepts any valid PNG)
  fs.writeFileSync(dest128, sourcePNG);
  fs.writeFileSync(dest256, sourcePNG);
  console.log('✓ Created 128x128.png (using source)');
  console.log('✓ Created 128x128@2x.png (using source)');
  
  // Create ICO using source PNG
  const icoPath = path.join(iconsDir, 'icon.ico');
  fs.writeFileSync(icoPath, createICO(sourcePNG));
  console.log('✓ Created icon.ico');
  
  // Create ICNS using source PNG
  const icnsPath = path.join(iconsDir, 'icon.icns');
  fs.writeFileSync(icnsPath, createICNS(sourcePNG));
  console.log('✓ Created icon.icns');
} else {
  // Fallback to solid color placeholders
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

  const ico256 = createSolidPNG(256);
  const icoPath = path.join(iconsDir, 'icon.ico');
  fs.writeFileSync(icoPath, createICO(ico256));
  console.log('✓ Created icon.ico');

  const png128 = createSolidPNG(128);
  const icnsPath = path.join(iconsDir, 'icon.icns');
  fs.writeFileSync(icnsPath, createICNS(png128));
  console.log('✓ Created icon.icns');
}

console.log('');
console.log('✅ Icons generated successfully!');
console.log('');
console.log('Note: Using 32x32 source for all sizes.');
console.log('For best quality, provide a 1024x1024 PNG and run:');
console.log('  npm run tauri:icon');
