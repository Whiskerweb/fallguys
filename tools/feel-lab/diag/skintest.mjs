/**
 * Verifie que le rig pilote bien le squelette AUQUEL LE MESH EST ATTACHE.
 * SkeletonUtils.clone() reconstruit les os ; si la recherche par nom tombe sur des os
 * qui n'appartiennent pas au skeleton du SkinnedMesh, les rotations n'ont aucun effet
 * visible — les os bougent, le maillage ne suit pas.
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.addInitScript(() => localStorage.setItem('tumble-model', 'player-rigged'));
await page.goto('http://127.0.0.1:5273/?lowfx', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const l=document.getElementById('loading'); return l && getComputedStyle(l).display==='none'; }, { timeout: 180000 });
await page.waitForTimeout(900);
await page.keyboard.press('Enter');
await page.waitForFunction(() => parseFloat(document.getElementById('timer')?.textContent ?? '0') > 0.3, { timeout: 120000 });
await page.waitForTimeout(600);

const res = await page.evaluate(() => {
  const c = window.__probeCharacter?.();
  if (!c?.rig) return { err: 'pas de rig' };
  const out = { skinned: [], sameObject: null, boneCount: null, skeletonNames: [] };
  c.container.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    out.skinned.push(o.name || '(sans nom)');
    if (out.sameObject === null) {
      const sk = o.skeleton;
      out.boneCount = sk.bones.length;
      out.skeletonNames = sk.bones.slice(0, 5).map((b) => b.name);
      const fromSkeleton = sk.bones.find((b) => b.name === 'LeftArm');
      const fromRig = c.rig.bones.get('LeftArm');
      out.sameObject = !!fromSkeleton && fromSkeleton === fromRig;
      out.skeletonHasLeftArm = !!fromSkeleton;
      out.rigHasLeftArm = !!fromRig;
      // Le mesh est-il un enfant du meme sous-arbre que les os ?
      out.meshParent = o.parent?.name ?? '(racine)';
      out.rigArmParent = fromRig?.parent?.name ?? null;
      out.skeletonArmParent = fromSkeleton?.parent?.name ?? null;
    }
  });
  return out;
});
await browser.close();
console.log(JSON.stringify(res, null, 2));
