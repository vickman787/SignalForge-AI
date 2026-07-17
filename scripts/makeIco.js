import fs from 'fs';
import path from 'path';
import toIco from 'to-ico';

const publicDir = path.join(process.cwd(), 'public');
const pngs = [
  path.join(publicDir, 'favicon-64.png'),
  path.join(publicDir, 'favicon-32.png'),
  path.join(publicDir, 'favicon-16.png'),
];

async function make() {
  try {
    const buffers = pngs.map((p) => fs.readFileSync(p));
    const ico = await toIco(buffers);
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), ico);
    console.log('Created multi-resolution favicon.ico');
  } catch (err) {
    console.error('Failed to create ICO:', err);
    process.exitCode = 1;
  }
}

make();
