"""Reference-only geometry audit. Ground-truth cameras are used after reconstruction, never by SfM."""
import argparse
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
import pycolmap
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation


def triangles_from_glb(path):
    raw=path.read_bytes()
    size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size])
    binary=raw[28+size:]
    def accessor(index):
        a=doc['accessors'][index]
        view=doc['bufferViews'][a['bufferView']]
        dtype=np.dtype({5121:'u1',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
        dim={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
        return np.ndarray((a['count'],dim),dtype=dtype,buffer=binary,offset=view.get('byteOffset',0)+a.get('byteOffset',0),strides=(view.get('byteStride',dim*dtype.itemsize),dtype.itemsize)).copy()
    triangles=[]
    labels=[]
    def visit(index,parent,label='housing/unassigned'):
        node=doc['nodes'][index]
        local=np.eye(4)
        if 'matrix' in node:
            local=np.array(node['matrix']).reshape((4,4),order='F')
        else:
            local[:3,:3]=Rotation.from_quat(node.get('rotation',[0,0,0,1])).as_matrix()@np.diag(node.get('scale',[1,1,1]))
            local[:3,3]=node.get('translation',[0,0,0])
        world=parent@local
        label=node.get('extras',{}).get('componentId',label)
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                positions=accessor(primitive['attributes']['POSITION'])
                faces=accessor(primitive['indices']).reshape((-1,3))
                positions=positions@world[:3,:3].T+world[:3,3]
                triangles.extend(positions[faces])
                labels.extend([label]*len(faces))
        for child in node.get('children',[]):
            visit(child,world,label)
    for root in doc['scenes'][doc.get('scene',0)]['nodes']:
        visit(root,np.eye(4))
    return np.array(triangles),np.array(labels)


def similarity(x,y):
    mx,my=x.mean(0),y.mean(0)
    u,s,vt=np.linalg.svd((x-mx).T@(y-my)/len(x))
    signs=np.array([1,1,np.linalg.det(vt.T@u.T)])
    rotation=vt.T@np.diag(signs)@u.T
    scale=float((s*signs).sum()/np.mean(np.sum((x-mx)**2,axis=1)))
    translation=my-scale*rotation@mx
    return scale,rotation,translation


def point_triangle_distances(points,triangles):
    """Paired point-to-triangle distances, vectorized over leading dimensions."""
    a,b,c=triangles[...,0,:],triangles[...,1,:],triangles[...,2,:]
    ab,ac,ap=b-a,c-a,points-a
    aa=np.sum(ab*ab,axis=-1)
    bb=np.sum(ac*ac,axis=-1)
    dot=np.sum(ab*ac,axis=-1)
    raw_d=aa*bb-dot*dot
    d=np.maximum(raw_d,1e-30)
    u=(bb*np.sum(ap*ab,axis=-1)-dot*np.sum(ap*ac,axis=-1))/d
    v=(aa*np.sum(ap*ac,axis=-1)-dot*np.sum(ap*ab,axis=-1))/d
    normal=np.cross(ab,ac)
    plane=np.sum(ap*normal,axis=-1)**2/np.maximum(np.sum(normal*normal,axis=-1),1e-30)
    result=np.where((raw_d>1e-30)&(u>=0)&(v>=0)&(u+v<=1),plane,np.inf)
    for start,end in [(a,b),(b,c),(c,a)]:
        edge=end-start
        along=np.clip(np.sum((points-start)*edge,axis=-1)/np.maximum(np.sum(edge*edge,axis=-1),1e-30),0,1)
        distance=np.sum((points-start-along[...,None]*edge)**2,axis=-1)
        result=np.minimum(result,distance)
    return np.sqrt(np.maximum(result,0))


def nearest_surface(points,triangles):
    """Exact nearest-triangle search using radius bins and a centroid-distance lower bound."""
    centers=triangles.mean(axis=1)
    radius=np.max(np.linalg.norm(triangles-centers[:,None,:],axis=2),axis=1)
    bins=np.floor(np.log2(np.maximum(radius,1e-12))).astype(int)
    best=np.full(len(points),np.inf)
    for bucket in sorted(set(bins)):
        subset=triangles[bins==bucket]
        center=centers[bins==bucket]
        maximum=float(radius[bins==bucket].max())
        tree=cKDTree(center)
        nearest,_=tree.query(points,k=1)
        pending=np.flatnonzero(nearest-maximum<=best)
        k=min(16,len(subset))
        while len(pending):
            next_pending=[]
            for start in range(0,len(pending),512):
                ids=pending[start:start+512]
                distances,indices=tree.query(points[ids],k=k)
                if k==1:
                    distances=distances[:,None]
                    indices=indices[:,None]
                measured=point_triangle_distances(points[ids,None,:],subset[indices]).min(axis=1)
                best[ids]=np.minimum(best[ids],measured)
                if k<len(subset):
                    # Every unseen triangle is at least kth centroid distance minus maximum radius away.
                    next_pending.extend(ids[best[ids]>distances[:,-1]-maximum])
            pending=np.array(next_pending,dtype=int)
            k=min(k*2,len(subset))
    return best


def sample_surface(triangles,count,seed=17,with_normals=False):
    area=np.linalg.norm(np.cross(triangles[:,1]-triangles[:,0],triangles[:,2]-triangles[:,0]),axis=1)
    rng=np.random.default_rng(seed)
    selected=rng.choice(len(triangles),size=count,p=area/area.sum())
    u=np.sqrt(rng.random(count))
    v=rng.random(count)
    t=triangles[selected]
    points=(1-u[:,None])*t[:,0]+(u*(1-v))[:,None]*t[:,1]+(u*v)[:,None]*t[:,2]
    if with_normals:
        normals=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0])
        normals/=np.linalg.norm(normals,axis=1)[:,None]
        return points,normals
    return points


def visible_from_cameras(points,normals,triangles,cameras):
    """Exclude reference surfaces that no supplied source view can observe."""
    seen=np.zeros(len(points),dtype=bool)
    a=triangles[:,0]
    e1=triangles[:,1]-a
    e2=triangles[:,2]-a
    for camera in cameras:
        pending=np.flatnonzero((~seen)&(np.sum((camera-points)*normals,axis=1)>1e-10))
        s=camera-a
        q=np.cross(s,e1)
        numerator=np.sum(e2*q,axis=1)
        for start in range(0,len(pending),128):
            ids=pending[start:start+128]
            directions=points[ids]-camera
            h=np.cross(directions[:,None,:],e2[None,:,:])
            denominator=np.sum(e1[None,:,:]*h,axis=2)
            reciprocal=np.divide(1,denominator,out=np.zeros_like(denominator),where=np.abs(denominator)>1e-14)
            u=reciprocal*np.sum(s[None,:,:]*h,axis=2)
            v=reciprocal*np.sum(directions[:,None,:]*q[None,:,:],axis=2)
            t=reciprocal*numerator[None,:]
            occluded=np.any((np.abs(denominator)>1e-14)&(u>=-1e-9)&(u<=1+1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)&(t>1e-9)&(t<1-1e-7),axis=1)
            seen[ids[~occluded]]=True
    return seen


def statistics(distances):
    return {'meanMillimeters':float(distances.mean()*1000),'p95Millimeters':float(np.percentile(distances,95)*1000),
        'maxSampleMillimeters':float(distances.max()*1000),'coverageWithin1mm':float(np.mean(distances<=.001)),
        'coverageWithin2mm':float(np.mean(distances<=.002)),'coverageWithin5mm':float(np.mean(distances<=.005))}


def reference_camera_name(original, capture, timestamp=None, video_fps=None):
    if video_fps is not None:
        if not np.isfinite(video_fps) or video_fps<=0 or not np.isfinite(timestamp):
            raise ValueError('REFERENCE_VIDEO_CORRESPONDENCE_INVALID')
        name=f"view-{round(timestamp*video_fps):03}.png"
        if name not in {image['name'] for image in capture['images']}:
            raise ValueError('REFERENCE_VIDEO_CORRESPONDENCE_INVALID')
        return name
    matches=[image['name'] for image in capture['images'] if image['sha256']==original['sha256']]
    if len(matches)!=1:
        raise ValueError('REFERENCE_CAPTURE_INPUT_MISMATCH')
    return matches[0]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',required=True,type=Path)
    parser.add_argument('--capture',required=True,type=Path)
    parser.add_argument('--reference',required=True,type=Path)
    parser.add_argument('--video-fps',type=float)
    args=parser.parse_args()
    quality=json.loads((args.run/'quality.json').read_text())
    capture=json.loads(args.capture.read_text())
    source=args.reference.read_bytes()
    if capture.get('sourceModelSha256')!=hashlib.sha256(source).hexdigest():
        raise ValueError('REFERENCE_HASH_MISMATCH')
    centers=quality.get('recoveredCameraCenters')
    if centers is None:
        reconstruction=pycolmap.Reconstruction(args.run/'selected-sparse')
        centers=[{'name':image.name,'center':image.projection_center().tolist()} for image in reconstruction.images.values()]
    known={item['name']:item['centerInSourceCoordinates'] for item in capture['cameras']}
    expected=[]
    recovered=[]
    for image in centers:
        index=int(Path(image['name']).stem.split('-')[-1])
        original=quality['inputImages'][index]
        if args.video_fps is not None:
            timestamp=quality['sourceVideo']['frames'][index]['timestampSeconds']
            name=reference_camera_name(original,capture,timestamp,args.video_fps)
        else:
            name=reference_camera_name(original,capture)
        expected.append(known[name])
        recovered.append(image['center'])
    expected,recovered=np.array(expected),np.array(recovered)
    scale,rotation,translation=similarity(recovered,expected)
    camera_error=np.linalg.norm(scale*(recovered@rotation.T)+translation-expected,axis=1)
    reference,labels=triangles_from_glb(args.reference)
    candidate_path=args.run/quality['candidate']['file']
    if hashlib.sha256(candidate_path.read_bytes()).hexdigest()!=quality['candidate']['sha256']:
        raise ValueError('CANDIDATE_HASH_MISMATCH')
    candidate,_=triangles_from_glb(candidate_path)
    candidate=scale*(candidate@rotation.T)+translation
    report={'schemaVersion':'synthetic-accuracy.v1','referenceSha256':hashlib.sha256(source).hexdigest(),
        'candidateSha256':quality['candidate']['sha256'],'cameraCount':len(expected),'alignment':{'method':'known synthetic camera-center similarity; benchmark only',
        'scale':scale,'rotation':rotation.tolist(),'translation':translation.tolist(),'cameraRMSEMillimeters':float(np.sqrt(np.mean(camera_error**2))*1000)},
        'method':'seeded area-weighted surface samples; exact nearest-triangle distances in both directions; no shape fitting',
        'reconstructionToReference':statistics(nearest_surface(sample_surface(candidate,15000),reference)),
        'referenceToReconstruction':statistics(nearest_surface(sample_surface(reference,15000),candidate)),'referenceComponents':{}}
    sampled,normals=sample_surface(reference,15000,with_normals=True)
    visible=visible_from_cameras(sampled,normals,reference,expected)
    report['visibleReferenceToReconstruction']={**statistics(nearest_surface(sampled[visible],candidate)),'visibleSampleCount':int(visible.sum()),'totalReferenceSampleCount':len(sampled)}
    for label in sorted(set(labels)):
        sampled,normals=sample_surface(reference[labels==label],3000,with_normals=True)
        visible=visible_from_cameras(sampled,normals,reference,expected)
        report['referenceComponents'][label]={'allSurfaces':statistics(nearest_surface(sampled,candidate)),'visibleSurfaces':statistics(nearest_surface(sampled[visible],candidate)) if visible.any() else None,'visibleSampleCount':int(visible.sum()),'totalSampleCount':len(sampled)}
    report['componentMetricMeaning']='Distance from each reference component to any reconstructed surface, not validated segmentation or mechanical operation'
    report['approval']='Unapproved benchmark evidence. Accuracy and hidden geometry for customer images remain unproven.'
    (args.run/'accuracy.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({key:report[key] for key in ['alignment','reconstructionToReference','visibleReferenceToReconstruction','referenceComponents']},indent=2))


if __name__=='__main__':
    main()
