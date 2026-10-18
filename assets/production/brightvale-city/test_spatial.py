"""Blender Python regression fixtures: batching-only, bounds and exact attributes."""
import sys,unittest,copy
from pathlib import Path
sys.dont_write_bytecode=True;sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from spatial_core import recover_pieces,partition,pack,bounding_sphere
from optimization_core import accessor
from glb_checks import check_contract,count_scene
from test_transfer import TransferChecks

def piece(i,x=0,span=1,material=0,family='02'):
    xyz=np.array([[x,0,0],[x+span,0,0],[x,1,0]],dtype='<f4');normal=np.array([[0,0,1]]*3,dtype='<f4');normal[0,0]=-0.0
    return dict(id=i,source_object=f'Original.{i}',family=family,material=material,old_batch='Before',old_index_offset=i*3,attrs={'POSITION':xyz,'NORMAL':normal,'TEXCOORD_0':np.array([[0,0],[1,0],[0,1]],dtype='<f4')},indices=np.array([0,1,2],dtype='<u4'),lo=xyz.min(axis=0),hi=xyz.max(axis=0))
def document():return dict(asset={'version':'2.0'},nodes=[dict(name='CITY.ProvisionalLayout',extras={'unchanged':'yes'})],materials=[dict(name='Window',extras={'city_role':'emissive_window'}),dict(name='Stone',extras={'city_role':'city.masonry'})])
class SpatialTests(unittest.TestCase):
    def test_oversized_original_is_never_merged(self):
        p=[piece(0,0,40),piece(1,17),piece(2,18)];g=partition(p,16,24);self.assertEqual(len(g),2);big=next(a for a in g if a['oversized_original_piece']);self.assertEqual([m['id'] for m in big['members']],[0])
    def test_bounds_limit_not_only_centers(self):
        p=[piece(0,-10,20),piece(1,5,20)];g=partition(p,16,24);self.assertEqual(len(g),2);self.assertTrue(all(float((a['hi']-a['lo']).max())<=24 for a in g))
    def test_family_material_and_uv_layout_never_merge(self):
        p=[piece(0),piece(1,material=1),piece(2,family='07'),piece(3)];del p[-1]['attrs']['TEXCOORD_0'];self.assertEqual(len(partition(p,16,24)),4)
    def test_loader_uses_half_diagonal_sphere(self):
        g=dict(lo=np.array([0,0,0]),hi=np.array([4,6,8]),members=[]);c,r=bounding_sphere(g);np.testing.assert_equal(c,[2,3,4]);self.assertAlmostEqual(r,np.linalg.norm([4,6,8])/2)
    def test_deterministic_partition_and_exact_attributes(self):
        p=[piece(0),piece(1,3),piece(2,material=1)];groups=partition(p,16,24);d,b,c=pack(document(),groups);again,bb,cc=pack(document(),partition(list(reversed(p)),16,24));self.assertEqual(d,again);self.assertEqual(b,bb);self.assertEqual(c,cc);self.assertTrue(check_contract(d));self.assertEqual(count_scene(d)['placed_triangles'],3)
        for node,group in zip(d['nodes'][1:],c['groups']):
            prim=d['meshes'][node['mesh']]['primitives'][0];ii=accessor(d,b,prim['indices'])[:,0];offset=0
            for member in group['members']:
                source=p[member['piece_id']]
                for k,v in source['attrs'].items():self.assertEqual(v[source['indices']].tobytes(),accessor(d,b,prim['attributes'][k])[ii[offset:offset+3]].tobytes())
                offset+=3
    def test_recovery_uses_only_referenced_vertices(self):
        p=[piece(0,-50),piece(1,50)];g=[dict(members=p,lo=np.array([-50,0,0]),hi=np.array([51,1,0]),oversized_original_piece=False)];d,b,c=pack(document(),g)
        # Adapt output provenance into the retained baseline coverage schema.
        c['groups'][0]['members']=[dict(source_object=x['source_object'],triangles=x['triangles']) for x in c['groups'][0]['members']]
        recovered=recover_pieces(d,b,c);self.assertEqual(len(recovered),2);self.assertEqual(float(recovered[0]['hi'][0]),-49);self.assertEqual(float(recovered[1]['lo'][0]),50)
        invalid=copy.deepcopy(d);invalid['nodes'][1]['scale']=[2,2,2]
        with self.assertRaises(AssertionError):recover_pieces(invalid,b,c)
        invalid=copy.deepcopy(d);invalid['nodes'][1]['extensions']={'EXT_mesh_gpu_instancing':{'attributes':{'TRANSLATION':0}}}
        with self.assertRaises(AssertionError):recover_pieces(invalid,b,c)

suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in [TransferChecks,SpatialTests]])
result=unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():raise RuntimeError('Spatial tests failed')
