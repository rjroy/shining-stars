import copy,json,struct,tempfile,unittest,sys
from pathlib import Path
sys.dont_write_bytecode=True
from glb_checks import count_scene,read_glb,identity,check_contract,write_glb,finalize_material_contract

def fixture():
    return dict(scene=0,scenes=[dict(nodes=[0])],nodes=[dict(name='CITY.ProvisionalLayout',children=[1,2]),dict(mesh=0),dict(mesh=1,extensions={'EXT_mesh_gpu_instancing':{'attributes':{'TRANSLATION':2}}})],meshes=[dict(primitives=[dict(indices=0)]),dict(primitives=[dict(indices=1)])],accessors=[dict(count=3),dict(count=6),dict(count=4)],materials=[dict(name='Window')],buffers=[dict(byteLength=0)])
class TransferChecks(unittest.TestCase):
    def test_ordinary_and_four_instances(self):
        c=count_scene(fixture());self.assertEqual(c['unique_triangles'],3);self.assertEqual(c['placed_triangles'],9);self.assertEqual(c['mesh_placements'],5);self.assertEqual(c['gpu_instanced_nodes'],1)
    def test_linked_mesh_nodes_not_gpu_instances(self):
        d=fixture();d['nodes'][2]={'mesh':0};d['meshes']=d['meshes'][:1]
        c=count_scene(d);self.assertEqual(c['unique_triangles'],1);self.assertEqual(c['placed_triangles'],2);self.assertEqual(c['gpu_instanced_nodes'],0)
    def test_inconsistent_instances_fail(self):
        d=fixture();d['nodes'][2]['extensions']['EXT_mesh_gpu_instancing']['attributes']['SCALE']=0
        with self.assertRaises(ValueError):count_scene(d)
    def test_cycles_fail(self):
        d=fixture();d['nodes'][1]['children']=[0]
        with self.assertRaises(ValueError):count_scene(d)
    def test_contract_and_transform_guard(self):
        d=fixture();self.assertTrue(check_contract(d));d['nodes'][0]['scale']=[.35]*3
        with self.assertRaises(ValueError):check_contract(d)
    def test_dependency_guard(self):
        d=fixture();d['buffers'][0]['uri']='outside.bin'
        with self.assertRaises(ValueError):check_contract(d)
    def test_glb_roundtrip_and_bad_header(self):
        data=json.dumps(fixture()).encode();data+=b' '*((-len(data))%4);payload=struct.pack('<4sII',b'glTF',2,20+len(data))+struct.pack('<II',len(data),0x4e4f534a)+data
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'fixture.glb';p.write_bytes(payload);doc,binary=read_glb(p);self.assertEqual(doc,fixture());self.assertEqual(binary,b'')
            p.write_bytes(b'bad')
            with self.assertRaises(ValueError):read_glb(p)
    def test_default_identity(self):
        self.assertTrue(identity({}));self.assertFalse(identity({'translation':[0,3.9,-55]}))
    def test_subunit_emission_strength_not_folded_or_clamped(self):
        d={'materials':[{'name':'Window'}]};src=[dict(export_material='Window',source_material='Real window',city_role='emissive_window',proposed_semantic_role='city.glazing',ior=1.5,emission_color=[.6,.2,.1],emission_strength=.02)]
        finalize_material_contract(d,src);m=d['materials'][0]
        self.assertEqual(m['emissiveFactor'],[.6,.2,.1]);self.assertEqual(m['extensions']['KHR_materials_emissive_strength']['emissiveStrength'],.02)
    def test_material_contract_preserves_values(self):
        d={'materials':[{'name':'Water','emissiveFactor':[.1,.2,.3],'pbrMetallicRoughness':{'baseColorFactor':[.2,.3,.4,1]}}]}
        src=[dict(export_material='Water',source_material='Original water',city_role='city.water.surface',proposed_semantic_role='city.water.surface',ior=1.333)]
        names=finalize_material_contract(d,src);self.assertEqual(names,['Water']);m=d['materials'][0]
        self.assertEqual(m['extensions']['KHR_materials_ior']['ior'],1.333);self.assertEqual(m['emissiveFactor'],[.1,.2,.3]);self.assertEqual(m['extras']['source_material'],'Original water')
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'test.glb';binary=b'abcd'*4;write_glb(p,d,binary);again,data=read_glb(p);self.assertEqual(again,d);self.assertEqual(data,binary)
if __name__=='__main__':unittest.main(verbosity=2)
