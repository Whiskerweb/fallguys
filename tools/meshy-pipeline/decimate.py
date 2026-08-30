"""
Allege un GLB par decimation, en conservant sa texture.
Un personnage a 172 000 triangles coute plus cher que tout le decor du niveau reuni, et
sera duplique des qu'il y aura des adversaires. Le ratio vise ~15 000 triangles, ce qui
reste tres au-dessus de nos assets generes (5 000 a 14 000).

Usage : blender -b -P decimate.py -- <entree.glb> <sortie.glb> <triangles_cibles>
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, target = argv[0], argv[1], int(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

total_before = 0
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    total_before += len(o.data.polygons)

print(f"[decimate] faces avant : {total_before}")

if total_before > target:
    ratio = max(0.02, target / total_before)
    for o in meshes:
        mod = o.modifiers.new(name="Decimate", type='DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"[decimate] ratio applique : {ratio:.4f}")

total_after = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
print(f"[decimate] faces apres : {total_after}")

# doubleSided double le cout de rendu pour un personnage ferme : on le desactive.
for m in bpy.data.materials:
    m.use_backface_culling = True

# Skinning et animations sont demandes EXPLICITEMENT. Ils sont actifs par defaut, mais
# c'est precisement ce qu'on ne veut pas perdre en silence sur un personnage anime : un
# modele qui ressort sans ses clips se voit seulement une fois dans le jeu, immobile.
bpy.ops.export_scene.gltf(
    filepath=dst, export_format='GLB',
    export_texture_dir='', export_yup=True,
    export_apply=True,
    export_skins=True,
    export_animations=True,
    export_anim_slide_to_zero=False,
)

clips = len(bpy.data.actions)
armatures = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
print(f"[decimate] armatures conservees : {len(armatures)} · actions : {clips}")
print(f"[decimate] ecrit : {dst}")
