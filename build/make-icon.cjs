// Renders build/icon.svg (+ build/maskable.svg) into:
//   build/icon.ico       multi-resolution Windows icon (app + electron-builder)
//   build/icon.png       256px (Electron window / fallback)
//   public/icon-192.png, public/icon-512.png   PWA icons (purpose "any")
//   public/apple-touch-icon.png                iOS home-screen icon (180px)
//   public/maskable-512.png                    PWA maskable icon (safe-zone padded)
// Run: node build/make-icon.cjs   (or: npm run icon)
const { Resvg } = require('@resvg/resvg-js')
const pngToIcoMod = require('png-to-ico')
const pngToIco = pngToIcoMod.default || pngToIcoMod
const fs = require('fs')
const path = require('path')

const here = __dirname
const pub = path.join(here, '..', 'public')

function render (svgPath, size) {
  const svg = fs.readFileSync(svgPath)
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

async function main () {
  const iconSvg = path.join(here, 'icon.svg')
  const maskSvg = path.join(here, 'maskable.svg')

  // Windows .ico (multi-res) + 256 png
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = icoSizes.map(s => render(iconSvg, s))
  fs.writeFileSync(path.join(here, 'icon.ico'), await pngToIco(pngs))
  fs.writeFileSync(path.join(here, 'icon.png'), render(iconSvg, 256))

  // PWA / phone icons
  fs.writeFileSync(path.join(pub, 'icon-192.png'), render(iconSvg, 192))
  fs.writeFileSync(path.join(pub, 'icon-512.png'), render(iconSvg, 512))
  fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), render(iconSvg, 180))
  fs.writeFileSync(path.join(pub, 'maskable-512.png'), render(maskSvg, 512))

  console.log('Wrote build/icon.ico, build/icon.png + public PWA icons (192, 512, apple-touch, maskable)')
}
main().catch(e => { console.error(e); process.exit(1) })
