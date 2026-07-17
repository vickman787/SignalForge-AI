import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const projectRoot = new URL('../../', import.meta.url).pathname.replace(/\\/g, '/');
const srcDir = path.join(process.cwd(), 'src', 'assets');
const publicDir = path.join(process.cwd(), 'public');

async function rasterize() {
  try {
    // Ensure output directories
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

    const logoSvg = path.join(srcDir, 'logo.svg');
    const ogSvg = path.join(publicDir, 'og-banner.svg');

    // Generate logo PNG at multiple sizes
    const logoPng = path.join(srcDir, 'logo.png');
    const logoPng512 = path.join(srcDir, 'logo@512.png');
    await sharp(logoSvg).resize(256, 256, {fit: 'contain', background: {r:0,g:0,b:0,alpha:0}}).png().toFile(logoPng);
    await sharp(logoSvg).resize(512, 512, {fit: 'contain', background: {r:0,g:0,b:0,alpha:0}}).png().toFile(logoPng512);

    // Generate OG banner PNG 1200x630
    const ogPng = path.join(srcDir, 'og-banner.png');
    await sharp(ogSvg).resize(1200, 630, {fit: 'cover'}).png().toFile(ogPng);

    // Create favicon png sizes and then ico
    const faviconPng16 = path.join(publicDir, 'favicon-16.png');
    const faviconPng32 = path.join(publicDir, 'favicon-32.png');
    const faviconPng64 = path.join(publicDir, 'favicon-64.png');
    await sharp(logoSvg).resize(16,16).png().toFile(faviconPng16);
    await sharp(logoSvg).resize(32,32).png().toFile(faviconPng32);
    await sharp(logoSvg).resize(64,64).png().toFile(faviconPng64);

    const icoPath = path.join(publicDir, 'favicon.ico');
    const buf64 = fs.readFileSync(faviconPng64);
    const buf32 = fs.readFileSync(faviconPng32);
    const buf16 = fs.readFileSync(faviconPng16);
    let buffer;
    try {
      buffer = await pngToIco([buf64, buf32, buf16]);
    } catch (e1) {
      console.warn('png-to-ico failed with order 64,32,16 — retrying with 32,16,64', e1.message);
      try {
        buffer = await pngToIco([buf32, buf16, buf64]);
      } catch (e2) {
        console.warn('png-to-ico retry failed — falling back to copying 64px PNG as .ico', e2.message);
        // fallback: copy 64px png to favicon.ico (many browsers accept PNG favicons when linked)
        fs.copyFileSync(faviconPng64, icoPath);
        buffer = null;
      }
    }
    if (buffer) fs.writeFileSync(icoPath, buffer);

    console.log('Rasterization complete: logo and og-banner PNGs, favicon.ico created.');
  } catch (err) {
    console.error('Rasterization failed:', err);
    process.exitCode = 1;
  }
}

rasterize();
