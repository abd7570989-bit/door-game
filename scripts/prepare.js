// Builds app/ from game/game.html so the game runs fully offline inside the EXE:
//  - three.js r128 is loaded from a local copy instead of cdnjs
//  - the Google Fonts are replaced by local copies (from @fontsource)
// The build fails if the game still references anything on the internet.
//
// To update the game: replace game/game.html with the new version and rebuild.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "app");
const vendor = path.join(out, "vendor");
const fontsOut = path.join(vendor, "fonts");

// [package, weights] matching the Google Fonts URL in the game.
const FONTS = [
  ["@fontsource/noto-kufi-arabic", [400, 600, 800]],
  ["@fontsource/noto-naskh-arabic", [400, 600]],
  ["@fontsource/aref-ruqaa", [400, 700]],
  ["@fontsource/caveat", [500]],
];

function fail(msg) {
  console.error("prepare-game: " + msg);
  process.exit(1);
}

function replaceOnce(html, pattern, replacement, what) {
  const matches = html.match(new RegExp(pattern.source, "g" + pattern.flags.replace("g", "")));
  if (!matches || matches.length !== 1) fail(`expected exactly one ${what}, found ${matches ? matches.length : 0}`);
  return html.replace(pattern, replacement);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fontsOut, { recursive: true });

let html = fs.readFileSync(path.join(root, "game", "game.html"), "utf8");

html = replaceOnce(html, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/,
  '<script src="vendor/three.min.js"></script>', "three.js script tag");
html = html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*/g, "");
html = replaceOnce(html, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*" rel="stylesheet">/,
  '<link href="vendor/fonts.css" rel="stylesheet">', "Google Fonts stylesheet");

// Anything still loaded from the network would break offline play.
const remote = html.match(/\b(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
const cssRemote = html.match(/url\(\s*["']?https?:\/\/[^)]+\)/gi) || [];
const importRemote = html.match(/@import\s+(?:url\()?["']?https?:\/\//gi) || [];
if (remote.length || cssRemote.length || importRemote.length) {
  fail("game still loads from the internet:\n  " + [...remote, ...cssRemote, ...importRemote].join("\n  "));
}

fs.writeFileSync(path.join(out, "index.html"), html);
fs.copyFileSync(require.resolve("three/build/three.min.js"), path.join(vendor, "three.min.js"));

let css = "";
let fileCount = 0;
for (const [pkg, weights] of FONTS) {
  const pkgDir = path.dirname(require.resolve(pkg + "/package.json"));
  for (const w of weights) {
    const cssPath = path.join(pkgDir, `${w}.css`);
    if (!fs.existsSync(cssPath)) fail(`missing ${pkg} weight ${w}`);
    css += fs.readFileSync(cssPath, "utf8").replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => {
      const src = path.join(pkgDir, "files", file);
      if (!fs.existsSync(src)) fail("missing font file " + src);
      if (!fs.existsSync(path.join(fontsOut, file))) {
        fs.copyFileSync(src, path.join(fontsOut, file));
        fileCount++;
      }
      return `url(fonts/${file})`;
    }) + "\n";
  }
}
fs.writeFileSync(path.join(vendor, "fonts.css"), css);
console.log(`prepare-game: app/index.html ready (three.js r128 + ${fileCount} font files, no network needed)`);
