import unittest
import numpy as np
from measure_accuracy import nearest_surface,point_triangle_distances,similarity,visible_from_cameras,reference_camera_name


class AccuracyChecks(unittest.TestCase):
    def test_reference_correspondence_uses_hashes_after_server_renaming(self):
        capture={'images':[{'name':'view-017.png','sha256':'abc'}]}
        self.assertEqual(reference_camera_name({'name':'server-copy-000.png','sha256':'abc'},capture),'view-017.png')
        with self.assertRaisesRegex(ValueError,'INPUT_MISMATCH'):
            reference_camera_name({'name':'view-017.png','sha256':'different'},capture)
        self.assertEqual(reference_camera_name({},capture,17/4,4),'view-017.png')
        with self.assertRaisesRegex(ValueError,'CORRESPONDENCE_INVALID'):
            reference_camera_name({},capture,1,4)
    def test_visibility_excludes_occluded_and_back_facing_surfaces(self):
        triangle=np.array([[[0.,0,0],[1,0,0],[0,1,0]]])
        points=np.array([[.2,.2,0.]])
        normals=np.array([[0.,0,1]])
        camera=np.array([[.2,.2,1.]])
        self.assertEqual(visible_from_cameras(points,normals,triangle,camera).tolist(),[True])
        blocker=np.array([[[-1.,-1,.5],[2,-1,.5],[-1,2,.5]]])
        self.assertEqual(visible_from_cameras(points,normals,np.concatenate([triangle,blocker]),camera).tolist(),[False])
        self.assertEqual(visible_from_cameras(points,normals,triangle,-camera).tolist(),[False])

    def test_known_point_triangle_distances(self):
        triangle=np.array([[0.,0,0],[1,0,0],[0,1,0]])
        points=np.array([[.2,.2,1],[1,1,0],[-1,0,0],[.1,.1,0]])
        self.assertTrue(np.allclose(point_triangle_distances(points,triangle),[1,np.sqrt(.5),1,0]))
        degenerate=np.zeros((3,3))
        self.assertTrue(np.allclose(point_triangle_distances(points,degenerate),np.linalg.norm(points,axis=1)))

    def test_accelerated_search_matches_exhaustive(self):
        rng=np.random.default_rng(17)
        triangles=rng.normal(size=(150,3,3))*np.geomspace(.0001,100,150)[:,None,None]
        points=rng.normal(size=(100,3))
        expected=point_triangle_distances(points[:,None,:],triangles[None,:,:,:]).min(axis=1)
        actual=nearest_surface(points,triangles)
        self.assertTrue(np.allclose(actual,expected,atol=1e-10))

    def test_similarity_recovers_scale_rotation_without_reflection(self):
        rng=np.random.default_rng(8)
        points=rng.normal(size=(48,3))
        rotation=np.array([[0.,0,1],[0,1,0],[-1,0,0]])
        target=.37*(points@rotation.T)+[1.,2.,3.]
        scale,estimated,translation=similarity(points,target)
        self.assertAlmostEqual(scale,.37)
        self.assertGreater(np.linalg.det(estimated),.999999)
        self.assertTrue(np.allclose(scale*(points@estimated.T)+translation,target))


if __name__=='__main__':
    unittest.main()
