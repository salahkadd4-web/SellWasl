// Icônes de la PWA (phase 22) depuis public/logo.png : le monogramme « SW » centré sur fond blanc.
// Usage : node scripts/icons.mjs
import sharp from 'sharp';

const SOURCE = 'public/logo.png';
// Zone du monogramme dans le logo (1536 × 1024), sans le nom ni le slogan
const MARK = { left: 190, top: 315, width: 390, height: 300 };

// Découpe puis rognage du blanc autour, en deux passes (sharp applique sinon le rognage avant)
const area = await sharp(SOURCE).extract(MARK).png().toBuffer();
const mark = await sharp(area).trim({ threshold: 20 }).png().toBuffer();

/** Carré `size` px, monogramme à `ratio` de la largeur, fond blanc. */
async function icon(size, ratio, file) {
  const inner = Math.round(size * ratio);
  const resized = await sharp(mark).resize(inner, inner, { fit: 'inside' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toFile(file);
}

await icon(192, 0.8, 'public/icon-192.png');
await icon(512, 0.8, 'public/icon-512.png');
// « maskable » : zone de sécurité de 80 % du diamètre, le monogramme reste entier une fois rogné
await icon(512, 0.58, 'public/icon-maskable-512.png');
await icon(180, 0.78, 'public/apple-touch-icon.png');
await icon(48, 0.86, 'public/favicon-48.png');
console.log('Icônes générées.');
