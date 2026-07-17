import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const srcLogo = path.join(process.cwd(), 'src', 'assets', 'logo.png');
const publicDir = path.join(process.cwd(), 'public');

async function run() {
  if (!fs.existsSync(srcLogo)) {
    console.error('Source logo not found:', srcLogo);
    process.exit(1);
  }
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

  const sizes = [16, 32, 64];
  try {
    for (const s of sizes) {
      const out = path.join(publicDir, `favicon-${s}.png`);
      await sharp(srcLogo).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out);
      console.log('Wrote', out);
    }
    const icoSrc = path.join(publicDir, 'favicon-64.png');
    const icoDest = path.join(publicDir, 'favicon.ico');
    fs.copyFileSync(icoSrc, icoDest);
    console.log('Copied favicon-64.png -> favicon.ico');
    process.exit(0);
  } catch (err) {
    console.error('Failed to update favicons:', err);
    process.exit(1);
  }
}

run();
