"""Reproduce the approved static highway as a NEW candidate, with unchanged context.
Required --output-dir NEW under this package or /tmp/opencode; optional --length.
No source overwrite, export, runtime changes or third-party dependencies.
Approved highway.blend is never overwritten. Generated highway-candidate.blend and
historical candidate labels intentionally remain safeguards for future revisions.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
PLATFORM=ROOT.parent/'neon-twilight-platform/platform.blend'
ENDCAPS=ROOT.parent/'brightvale-platform-endcaps/endcaps.blend'
SOURCE_HASHES={PLATFORM:'ff0238b76c7373f6ccc595d14dd3b01a179e92805d1c8cfd0af0f9c920ba52af',
               ENDCAPS:'c49ae80c34350ddb7281c3192c4ed90921852f0386fa047a9196087cc13b4207'}
CANDIDATE='CANDIDATE | static highway | UNAPPROVED'
PLATFORM_REF='REFERENCE | approved platform | context only'
ENDCAP_REF='REFERENCE | approved endcaps | context only'
STUDIO='STUDIO | preserved platform comparison rig'

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def source_integrity():
    for p,expected in SOURCE_HASHES.items(): assert sha(p)==expected,('Approved source changed',str(p))
    return {p.name:sha(p) for p in SOURCE_HASHES}
def output_path(p):
    p=p.resolve()
    if not any(p.is_relative_to(r) and p!=r for r in (ROOT,Path('/tmp/opencode'))):
        raise ValueError('Output outside authorized highway package/scratch')
    return p
def bounds(objects):
    dg=bpy.context.evaluated_depsgraph_get(); pts=[]
    for o in objects:
        ev=o.evaluated_get(dg); me=ev.to_mesh()
        pts.extend(o.matrix_world@v.co for v in me.vertices); ev.to_mesh_clear()
    lo=[min(v[i] for v in pts) for i in range(3)]; hi=[max(v[i] for v in pts) for i in range(3)]
    return {'min':lo,'max':hi,'dimensions':[hi[i]-lo[i] for i in range(3)]}
def measure(platform_objects):
    panels=sorted([o for o in platform_objects if o.name.startswith('Inset lane')],key=lambda o:o.name)
    result=[]
    for i,p in enumerate(panels):
        b=bounds([p]); center=(b['min'][0]+b['max'][0])/2
        frame=next(o for o in platform_objects if o.name=='Lane %d | substantial continuous profiled border'%(i+1))
        hit=next(o for o in platform_objects if o.name=='Hit bar %d | recessed luminous center'%(i+1))
        h=bounds([hit]); f=bounds([frame])
        result.append({'index':i,'x':center,'width':b['dimensions'][0],'surface_z':b['max'][2],
                       'panel_bounds':b,'frame_bounds':f,'hit_y':(h['min'][1]+h['max'][1])/2})
    assert len(result)==4
    assert all(abs(result[i]['x']-(-4.5+3*i))<1e-6 for i in range(4))
    chassis=next(o for o in platform_objects if o.name.startswith('Platform |'))
    return {'lanes':result,'chassis':bounds([chassis]),'platform':bounds(platform_objects)}

def material(name,color,metal=.0,rough=.4,emission=.0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    bs=m.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    if emission:
        bs.inputs['Emission Color'].default_value=(*color,1); bs.inputs['Emission Strength'].default_value=emission
    return m

def mesh(name,vertices,faces,mats,collection,indices=None,bevel=0):
    me=bpy.data.meshes.new(name+' mesh'); me.from_pydata(vertices,[],faces)
    for mat in mats: me.materials.append(mat)
    if indices:
        for p,i in zip(me.polygons,indices): p.material_index=i
    bm=bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
    bm.to_mesh(me); bm.free(); me.update()
    o=bpy.data.objects.new(name,me); collection.objects.link(o)
    # Every highway part uses a common useful authoring junction origin.
    origin=Vector((0,2.7,0))
    for v in me.vertices: v.co-=origin
    o.location=origin
    if bevel:
        b=o.modifiers.new('Controlled profile bevel','BEVEL'); b.width=bevel; b.segments=3
        o.modifiers.new('Weighted machined normals','WEIGHTED_NORMAL')
    return o

def extrude(name,profile,front,back,mats,collection,bevel=.008):
    n=len(profile)
    vertices=[(x,y,z) for y in (front,back) for x,z in profile]
    faces=[tuple(range(n)),tuple(range(n,2*n))]
    for i in range(n):
        j=(i+1)%n; faces.append((i,j,n+j,n+i))
    return mesh(name,vertices,faces,mats,collection,bevel=bevel)

def lane_profile(start,end,top=.44):
    # Broad modular intervals, ~one lane pitch each. Grooves never split the bed.
    steps=max(2,round((end-2.7)/3)); pitch=(end-2.7)/steps
    rows=[(start,.502,.492),(2.57,.502,.492),(2.7,.502,.353),(3.15,top,.353)]
    for k in range(1,steps):
        y=2.7+k*pitch
        if y>3.3:
            rows.extend([(y-.017,top,.353),(y-.012,top-.003,.353),
                         (y+.012,top-.003,.353),(y+.017,top,.353)])
    rows.append((end,top,.353))
    return sorted(rows)

def strip(name,left,right,rows,mats,collection,bevel=.003,grooves=False):
    vertices=[(x,y,z) for y,zt,zb in rows for x,z in ((left,zb),(right,zb),(right,zt),(left,zt))]
    faces=[(0,1,2,3)]; indices=[0]
    for k in range(len(rows)-1):
        for i in range(4):
            j=(i+1)%4; faces.append((4*k+i,4*k+j,4*(k+1)+j,4*(k+1)+i))
            indices.append(1 if grooves and i==2 and abs(rows[k+1][0]-rows[k][0])<.03 else 0)
    faces.append(tuple(range(len(vertices)-4,len(vertices)))); indices.append(0)
    return mesh(name,vertices,faces,mats,collection,indices,bevel)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--output-dir',type=Path,required=True)
    p.add_argument('--length',type=float,default=18.,help='Positive +Y road length from chassis junction; authoring units')
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output=output_path(a.output_dir)
    if output.exists(): raise FileExistsError(output)
    if not math.isfinite(a.length) or not 6<=a.length<=60: raise ValueError('Review-supported length range is 6…60; not a runtime budget')
    before=source_integrity()
    bpy.ops.wm.open_mainfile(filepath=str(PLATFORM))
    scene=bpy.context.scene; originals=list(scene.objects)
    model=[o for o in originals if o.type in {'MESH','CURVE'} and not o.name.startswith('Studio')]
    measured=measure(model)
    ref=bpy.data.collections.new(PLATFORM_REF); er=bpy.data.collections.new(ENDCAP_REF)
    studio=bpy.data.collections.new(STUDIO); candidate=bpy.data.collections.new(CANDIDATE)
    for c in (ref,er,studio,candidate): scene.collection.children.link(c)
    for o in originals:
        for c in list(o.users_collection): c.objects.unlink(o)
        (ref if o in model else studio).objects.link(o)
    # Import exactly two approved endcap objects, not their platform/studio copies.
    with bpy.data.libraries.load(str(ENDCAPS),link=False) as (available,loaded):
        loaded.objects=[n for n in available.objects if n.startswith('Endcap |')]
    assert len(loaded.objects)==2
    for o in loaded.objects: er.objects.link(o)
    # Appended IDs carry weak absolute library locators (not actual linked inputs).
    # Copy those IDs locally and drop only the unused imported originals, retaining
    # exact geometry/material names while keeping the saved candidate relocatable.
    for o in loaded.objects:
        old=o.data; name=old.name; o.data=old.copy()
        assert old.users==0
        bpy.data.meshes.remove(old); o.data.name=name
    imported_mats={s.material for o in loaded.objects for s in o.material_slots}
    for old in sorted(imported_mats,key=lambda m:m.name):
        name=old.name; local=old.copy()
        for o in loaded.objects:
            for s in o.material_slots:
                if s.material==old: s.material=local
        assert old.users==0
        bpy.data.materials.remove(old); local.name=name
    for c in list(bpy.data.collections):
        if c not in (ref,er,studio,candidate) and not c.objects and not c.children:
            bpy.data.collections.remove(c)
    chassis_mat=material('Highway chassis | midnight-blue alloy',(.012,.024,.055),.50,.35)
    bed_mat=material('Highway lanes | quiet midnight enamel',(.017,.033,.071),.38,.34)
    seam_mat=material('Highway panels | broad quiet seam',(.015,.029,.062),.30,.48)
    metal=material('Highway edging | muted warm titanium',(.28,.19,.10),.72,.37)
    colors=[(.010,.18,.52),(.48,.018,.16),(.58,.22,.025),(.008,.34,.13)]
    accent_mats=[material('Highway inlay | '+n,c,.45,.30,.22) for n,c in zip(('cyan','magenta','amber','green'),colors)]
    front=measured['chassis']['max'][1]; back=front+a.length
    xs=[(l['x']-l['width']/2,l['x']+l['width']/2) for l in measured['lanes']]
    # A single sculpted cross section with four true recessed channels.
    profile=[(-6,-.22),(-5.92,-.30),(5.92,-.30),(6,-.22),(6,.40),(5.93,.49)]
    for left,right in reversed(xs):
        profile.extend([(right,.49),(right,.35),(left,.35),(left,.49)])
    profile.extend([(-5.93,.49),(-6,.40)])
    extrude('Highway | continuous four-channel profiled chassis',profile,front,back,[chassis_mat],candidate)
    rows=lane_profile(2.535,back)
    for i,(left,right) in enumerate(xs):
        o=strip('Highway lane %d | continuous inset bed and terminal ramp'%(i+1),left,right,rows,
                [bed_mat,seam_mat],candidate,grooves=True)
        # The ~31-degree seam ramps are already explicitly shaped. Beveling both
        # ramp borders can collapse their five-millimeter spans at some lengths.
        # Keep the 3 mm machining radius on sharper outside/profile edges only.
        o.modifiers['Controlled profile bevel'].angle_limit=math.radians(45)
        o['lane_index']=i
        # Four slim embedded cues only; flat/quiet gameplay width stays unobstructed.
        inlay_rows=[(2.57,.505,.496),(2.7,.505,.490),(3.15,.443,.430),(back,.443,.430)]
        strip('Highway lane %d | embedded colored edge inlay'%(i+1),left+.09,left+.125,
              inlay_rows,[accent_mats[i]],candidate,bevel=.002)
    # Fitted thin shoulder caps follow the actual sculpted chamfer, not floating rails.
    for side,label in [(-1,'left shoulder'),(1,'right shoulder')]:
        cap=[(side*5.90,.482),(side*5.93,.482),(side*6,.392),
             (side*6,.402),(side*5.93,.492),(side*5.90,.492)]
        extrude('Highway | slim muted metal '+label,cap,front,back,[metal],candidate,bevel=.0015)
    # Flat narrow separators, never a raised enclosing frame or container.
    for x,label,width in [(-3,'divider 1',.022),(0,'divider 2',.022),(3,'divider 3',.022)]:
        strip('Highway | slim muted metal '+label,x-width/2,x+width/2,
              [(front,.493,.480),(back,.493,.480)],[metal],candidate,bevel=.002)
    scene['highway_contract']=json.dumps({'length':a.length,'measured':measured,
        'junction':{'chassis_y':front,'nose_y':2.535,'bed_z':.44,'land_z':.49,'ramp_top_z':.502,
                    'nose_bottom_z':.492,'nose_frame_clearance':.002},
        'lane_axes':'parallel +Y, no taper','status':'UNAPPROVED candidate; no runtime/export'},sort_keys=True)
    scene['highway_source_checksums']=json.dumps(before,sort_keys=True)
    scene.render.filepath='//preview-output.png'
    output.mkdir(parents=True,exist_ok=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'highway-candidate.blend'))
    assert source_integrity()==before
    print('BUILD_PASS',json.dumps({'candidate_bounds':bounds(list(candidate.objects)),
          'lane_centers':[l['x'] for l in measured['lanes']],'length':a.length,'source_checksums':before}))

if __name__=='__main__': main()
