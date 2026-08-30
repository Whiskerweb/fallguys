/**
 * Continuite du sol le long des trajectoires jouables.
 * On tire un rayon vers le bas tous les metres : un trou dans le parcours se voit
 * immediatement, la ou l'oeil ne distingue pas un interstice d'une ombre.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
page.setDefaultTimeout(90000);
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(800);
await page.keyboard.press('Enter');
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 60000 });

const res = await page.evaluate(() => {
  const g = window.__probeGame?.(); const R = window.__RAPIER;
  if (!g || !R) return { err: 'sondes absentes (game=' + !!g + ', rapier=' + !!R + ')' };
  const world = g.course.world;
  // Le trace se decrit lui-meme : `course.trajectoires` renvoie la ligne moyenne
  // echantillonnee de chaque ruban. Recopier des polylignes a la main ici revenait a
  // tester une carte imaginaire des que le trace bougeait d'un metre.
  const voies = world && g.course.trajectoires
    ? g.course.trajectoires
    : {};
  const sortie = {};
  // Trois lignes par voie : l'axe et les deux bords, a 60 cm de la rambarde. Sonder le
  // seul axe laisserait passer un collider plus etroit que le ruban visible — le joueur
  // tomberait alors a travers un sol qu'il voit sous ses pieds.
  const RAYONS = [0, -1, 1];
  for (const [nom, pts] of Object.entries(voies)) {
    const trous = [];
    for (const cote of RAYONS) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const la = cote * (a.w / 2 - 0.7), lb = cote * (b.w / 2 - 0.7);
        const ax = a.x + a.nx * la, az = a.z + a.nz * la;
        const bx = b.x + b.nx * lb, bz = b.z + b.nz * lb;
        const d = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(d));
        // On s'arrete a 20 cm des extremites du ruban : un rayon tire pile sur le plan
        // du bouchon frole le triangle et rate une fois sur deux. C'est une limite du
        // lancer de rayon, pas un trou dans le sol.
        const k0 = i === 0 ? 1 : 0, k1 = i === pts.length - 2 ? n - 1 : n;
        for (let k = k0; k <= k1; k++) {
          const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
          const ray = new R.Ray({ x, y: 40, z }, { x: 0, y: -1, z: 0 });
          if (!world.castRay(ray, 70, true)) trous.push([+x.toFixed(1), +z.toFixed(1), cote]);
        }
      }
    }
    sortie[nom] = trous.length
      ? { trous: trous.length, plageZ: [Math.min(...trous.map(t=>t[1])), Math.max(...trous.map(t=>t[1]))], exemples: trous.slice(0, 4) }
      : 'sol continu (axe + deux bords)';
  }
  return sortie;
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
