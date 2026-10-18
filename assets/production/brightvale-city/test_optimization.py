"""Blender-bundled NumPy tests; no source or output asset edits."""
import sys,unittest,math
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy,numpy as np
from mathutils import Matrix,Quaternion,Vector
from optimization_core import policy,components,component_reduction_safe,batch_glb,accessor,transform_attributes,node_matrix
from glb_checks import count_scene,check_contract
from test_transfer import TransferChecks

class OptimizationTests(unittest.TestCase):
    def test_accepted_camera_projection_equivalence(self):
        c=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)));placement=Matrix.Translation((0,3.9,-55))@Matrix.Diagonal((.35,.35,.35,1))
        camera=Quaternion((.9983508744029035,-.05740672067761869,0,0)).to_matrix().to_4x4();camera.translation=Vector((0,15.980390877850041,18.503289237504333));native=(placement@c).inverted()@camera
        normalized=native.to_quaternion().to_matrix().to_4x4();normalized.translation=native.translation
        for point in [(-100,0,0),(0,0,97),(-45,67,97),(100,50,-10)]:
            original=camera.inverted()@placement@c@Vector(point);equivalent=normalized.inverted()@Vector(point)
            np.testing.assert_allclose([original.x/original.z,original.y/original.z],[equivalent.x/equivalent.z,equivalent.y/equivalent.z],atol=2e-6)
    def test_bounded_policy(self):
        self.assertEqual(policy('07',{'city.foliage'}),'leaf-collapse-0.5')
        self.assertEqual(policy('02',{'city.trim'}),'trim-planar-2deg')
        for family in ['01','04','05','06']:
            self.assertEqual(policy(family,{'city.trim'}),'protected')
        self.assertEqual(policy('07',{'city.foliage'},has_uv=True),'protected')
        self.assertEqual(policy('02',{'city.trim'},custom_normals=True),'protected')
        self.assertEqual(policy('03',{'city.roof'}),'protected')
        self.assertEqual(policy('02',{'emissive_window'}),'protected')
    def test_nonuniform_transform_and_inverse_transpose(self):
        n=1/math.sqrt(2);attrs={'POSITION':np.array([[0,0,0],[1,0,0],[0,1,1]],dtype='<f4'),'NORMAL':np.array([[0,-n,n]]*3,dtype='<f4'),'TEXCOORD_0':np.array([[0,0],[1,0],[1,1]],dtype='<f4')}
        m=node_matrix(dict(translation=[3,4,5],rotation=[0,0,n,n],scale=[2,3,4]));out=transform_attributes(attrs,m)
        np.testing.assert_allclose(out['POSITION'],[[3,4,5],[3,6,5],[0,4,9]],atol=1e-6);np.testing.assert_allclose(out['NORMAL'],[[.8,0,.6]]*3,atol=1e-6);np.testing.assert_array_equal(out['TEXCOORD_0'],attrs['TEXCOORD_0'])
    def test_leaf_components_survive_half_reduction(self):
        points=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)];faces=[(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]
        mesh=bpy.data.meshes.new('fixture');mesh.from_pydata(points+[(x+4,y,z) for x,y,z in points],[],faces+[tuple(i+6 for i in f) for f in faces]);obj=bpy.data.objects.new('fixture',mesh);bpy.context.scene.collection.objects.link(obj)
        try:
            mod=obj.modifiers.new('fixture','DECIMATE');mod.ratio=.5;mod.use_collapse_triangulate=True;bpy.context.view_layer.update();e=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());r=e.to_mesh();r.calc_loop_triangles();self.assertEqual(len(r.loop_triangles),8);self.assertEqual(components(r),2);e.to_mesh_clear()
        finally:bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
    def test_batch_material_transform_and_coverage(self):
        xyz=np.array([[0,0,0],[1,0,0],[0,1,0]],dtype='<f4');normal=np.array([[0,0,1]]*3,dtype='<f4');idx=np.array([[0],[1],[2]],dtype='<u4');binary=xyz.tobytes()+normal.tobytes()+idx.tobytes()
        doc=dict(asset={'version':'2.0'},scene=0,scenes=[dict(nodes=[0])],nodes=[dict(name='CITY.ProvisionalLayout',children=[1,2,3]),*[dict(mesh=0 if i<3 else 1,translation=[i*2,0,0],extras=dict(source_object=f'Source{i}',city_family='02')) for i in [1,2,3]]],meshes=[dict(primitives=[dict(attributes={'POSITION':0,'NORMAL':1},indices=2,material=i)]) for i in [0,1]],materials=[dict(name=n,extras=dict(source_material=n,city_role='city.trim')) for n in ['Window','Stone']],buffers=[dict(byteLength=len(binary))],bufferViews=[dict(buffer=0,byteOffset=0,byteLength=36),dict(buffer=0,byteOffset=36,byteLength=36),dict(buffer=0,byteOffset=72,byteLength=12)],accessors=[dict(bufferView=0,componentType=5126,count=3,type='VEC3'),dict(bufferView=1,componentType=5126,count=3,type='VEC3'),dict(bufferView=2,componentType=5125,count=3,type='SCALAR')])
        out,payload,coverage=batch_glb(doc,binary);self.assertTrue(check_contract(out));self.assertEqual(out['materials'],doc['materials']);self.assertEqual(count_scene(out)['placed_triangles'],3);self.assertEqual(count_scene(out)['mesh_nodes'],2);self.assertEqual(coverage['triangle_corners_exactly_checked'],9);self.assertEqual({m['source_object'] for g in coverage['groups'] for m in g['members']},{'Source1','Source2','Source3'})
        for mesh in out['meshes']:
            primitive=mesh['primitives'][0];self.assertEqual(out['accessors'][primitive['indices']]['componentType'],5123);self.assertEqual(len(accessor(out,payload,primitive['indices'])),3 if primitive['material']==1 else 6)
        all_x=[float(x) for a in out['accessors'] if a['type']=='VEC3' and a.get('min',[0,0,0])[0]>=2 for x in a['max'][:1]];self.assertTrue(all_x)
        # Index 65535 cannot use the reserved all-ones unsigned-short value.
        doc['nodes'][0]['children']=[1];doc['nodes']=doc['nodes'][:2]
        big=np.zeros((65536,3),dtype='<f4');big[:,0]=np.arange(65536);norm=np.tile(np.array([[0,0,1]],dtype='<f4'),(65536,1));indices=np.array([[0],[32768],[65535]],dtype='<u4');large=big.tobytes()+norm.tobytes()+indices.tobytes()
        doc['buffers'][0]['byteLength']=len(large);doc['bufferViews']=[dict(buffer=0,byteOffset=0,byteLength=big.nbytes),dict(buffer=0,byteOffset=big.nbytes,byteLength=norm.nbytes),dict(buffer=0,byteOffset=big.nbytes+norm.nbytes,byteLength=indices.nbytes)]
        doc['accessors'][0]['count']=doc['accessors'][1]['count']=65536
        packed,data,_=batch_glb(doc,large);index=packed['meshes'][0]['primitives'][0]['indices'];self.assertEqual(packed['accessors'][index]['componentType'],5125);self.assertEqual(int(accessor(packed,data,index).max()),65535)
        doc['nodes'][1]['extensions']={'EXT_mesh_gpu_instancing':{'attributes':{'TRANSLATION':0}}}
        with self.assertRaises(AssertionError):batch_glb(doc,large)
    def test_flattened_leaf_rejected_even_when_component_survives(self):
        a=bpy.data.meshes.new('original tetra');a.from_pydata([(1,0,0),(0,1,0),(0,0,1),(0,0,0)],[],[(0,1,2),(0,3,1),(1,3,2),(0,2,3)])
        b=bpy.data.meshes.new('flattened leaf');b.from_pydata([(1,0,0),(0,1,0),(0,0,0)],[],[(0,1,2)])
        try:
            self.assertEqual(components(a),components(b));self.assertFalse(component_reduction_safe(a,b,leaf=True));self.assertTrue(component_reduction_safe(a,a,leaf=True))
        finally:bpy.data.meshes.remove(a);bpy.data.meshes.remove(b)

suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in [TransferChecks,OptimizationTests]])
result=unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():raise RuntimeError('Optimization tests failed')
