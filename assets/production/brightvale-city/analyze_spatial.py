"""Bounded no-export sphere/frustum proxy analysis for recorded actual views."""
import json,sys,math
from pathlib import Path
sys.dont_write_bytecode=True
import numpy as np
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from glb_checks import read_glb,sha
from optimization_core import accessor,node_matrix,world_matrices,transform_attributes
from spatial_core import recover_pieces,partition,bounding_sphere
doc,binary=read_glb(ROOT/'city-optimized.glb');coverage=json.loads((ROOT/'batch-coverage.json').read_text());pieces=recover_pieces(doc,binary,coverage)
report=json.loads((ROOT/'evidence/consumer-optimized/optimized/report.json').read_text());game=report['captures'][1];camera=game['camera'];aspect=1440/900
obs_planes=np.array([[1,0,0,12.8],[-1,0,0,12.8],[0,1,0,5],[0,-1,0,5],[0,0,1,64],[0,0,-1,15.9]],dtype=float)
# Camera-coordinate planes for perspective gameplay, including near/far.
tx=math.tan(math.radians(camera['fov']/2))*aspect;ty=tx/aspect;game_planes=np.array([[1,0,-tx,0],[-1,0,-tx,0],[0,1,-ty,0],[0,-1,-ty,0],[0,0,-1,-camera['near']],[0,0,1,camera['far']]],dtype=float);game_planes/=np.linalg.norm(game_planes[:,:3],axis=1)[:,None]
cam=node_matrix(dict(translation=camera['position'],rotation=camera['quaternion']));cam_inverse=np.linalg.inv(cam);game_matrix=np.array(game['backend']['cityMatrix']).reshape(4,4).T
def proxy(groups):
    result={mode:dict(intersecting_groups=0,submitted_city_triangles_proxy=0) for mode in ['observatory','gameplay']};radii=[];spans=[]
    for g in groups:
        center,radius=g['proxy_sphere'] if 'proxy_sphere' in g else bounding_sphere(g);radii.append(radius);spans.append(float(np.max(g['hi']-g['lo'])));tri=sum(len(p['indices'])//3 for p in g['members'])
        for mode in result:
            if mode=='observatory':point=center*.18+np.array([0,-2.85,-7]);r=radius*.18;planes=obs_planes
            else:point=(cam_inverse@game_matrix@np.r_[center,1])[:3];r=radius*float(game_matrix[0,0]);planes=game_planes
            if np.all(planes[:,:3]@point+planes[:,3]>=-r):result[mode]['intersecting_groups']+=1;result[mode]['submitted_city_triangles_proxy']+=tri
    return dict(groups=len(groups),oversized_isolated=sum(g.get('oversized_original_piece',False) for g in groups),sphere_radius_BU_percentiles=np.percentile(radii,[50,90,99,100]).tolist(),max_axis_span_BU_percentiles=np.percentile(spans,[50,90,99,100]).tolist(),views=result)
def groups_from_doc(d,b):
    worlds=world_matrices(d);groups=[]
    for i,node in enumerate(d['nodes']):
        if 'mesh' not in node:continue
        for p in d['meshes'][node['mesh']]['primitives']:
            local={k:accessor(d,b,a) for k,a in p['attributes'].items()};xyz_local=local['POSITION'];center=(xyz_local.min(axis=0).astype(float)+xyz_local.max(axis=0))*.5;radius=float(np.linalg.norm(xyz_local.max(axis=0).astype(float)-xyz_local.min(axis=0)))*.5
            matrix=worlds[i];sphere=(matrix[:3,:3]@center+matrix[:3,3],radius*float(np.linalg.norm(matrix[:3,:3],axis=0).max()))
            attrs=transform_attributes(local,matrix);indices=accessor(d,b,p['indices'])[:,0];xyz=attrs['POSITION'];piece=dict(attrs=attrs,indices=indices);groups.append(dict(members=[piece],lo=xyz.min(axis=0),hi=xyz.max(axis=0),proxy_sphere=sphere))
    return groups
results=[]
full,fb=read_glb(ROOT/'city.glb');results.append(dict(configuration='full-original-primitives',**proxy(groups_from_doc(full,fb))));del full,fb
results.append(dict(configuration='retained-32-center-only',**proxy(groups_from_doc(doc,binary))))
results.append(dict(configuration='reduced-original-primitives',**proxy([dict(members=[p],lo=p['lo'],hi=p['hi']) for p in pieces])))
for cell,span in [(16,24),(8,12),(4,8)]:
    groups=partition(pieces,cell,span);results.append(dict(configuration=f'cell-{cell}-maxspan-{span}',cell_size_BU=cell,max_group_axis_span_BU=span,**proxy(groups)))
out=dict(status='Offline proxy analysis only; no candidate exports or renderer execution',source_optimized_sha256=sha(ROOT/'city-optimized.glb'),method='Installed Three GLTFLoader.js:4833-4840 uses AABB-center / half-diagonal spheres; transformed with largest axis scale for original unbaked objects. Spheres tested against recorded actual frusta. City geometry only, no shadow/overlay/other-scene work or occlusion; not measured calls, submitted triangles or timings. Original long primitives isolated, never split. Compact referenced vertices when recovering source pieces.',view_authority='consumer-optimized/{baseline,optimized}/report.json plus read-only src/rendering/observatory-scene.ts:40-55,85-89; 1440x900. Gameplay actual float32 city matrix and reported camera. Observatory .18/(0,-2.85,-7), ortho +/-12.8 horizontal,+/-5 vertical, camera(0,0,16), near .1/far80.',results=results)
(ROOT/'spatial-analysis.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
