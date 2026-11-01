"""Compare camera-only refinement against synthetic reference poses after SfM.

Reference poses are used for evaluation only, never supplied to reconstruction.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import pycolmap
from reconstruct import sfm
from measure_accuracy import similarity


def camera_errors(model,capture):
    known={item['name']:item['centerInSourceCoordinates'] for item in capture['cameras']}
    images=sorted(model.images.values(),key=lambda image:image.name)
    recovered=np.array([image.projection_center() for image in images])
    expected=np.array([known[image.name] for image in images])
    scale,rotation,translation=similarity(recovered,expected)
    errors=np.linalg.norm(scale*(recovered@rotation.T)+translation-expected,axis=1)*1000
    return {'registeredImages':model.num_reg_images(),'points':model.num_points3D(),'meanReprojectionPixels':model.compute_mean_reprojection_error(),
        'cameraRMSEmm':float(np.sqrt(np.mean(errors**2))),'cameraMeanMm':float(errors.mean()),'cameraMaxMm':float(errors.max())}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--images',required=True,type=Path)
    parser.add_argument('--capture',required=True,type=Path)
    parser.add_argument('--calibration',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True)
    calibration=json.loads(args.calibration.read_text())
    sfm(args.images.resolve(),args.output.resolve(),calibration,'high')
    # Only after modelling, load reference cameras for independent evaluation.
    capture=json.loads(args.capture.read_text())
    for item in capture['images']:
        if hashlib.sha256((args.images/item['name']).read_bytes()).hexdigest()!=item['sha256']:
            raise ValueError('REFERENCE_CAPTURE_INPUT_MISMATCH')
    selected=args.output/'selected-sparse'
    result={'baseline':camera_errors(pycolmap.Reconstruction(selected),capture),'refinements':{},'sfmPipelineSha256':hashlib.sha256(Path(__file__).with_name('reconstruct.py').read_bytes()).hexdigest(),'probeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'referenceUsedForEvaluationOnly':True}
    for loss in ['TRIVIAL','SOFT_L1','CAUCHY']:
        model=pycolmap.Reconstruction(selected)
        # https://colmap.github.io/legacy/4.0/pycolmap/pycolmap.html#pycolmap.bundle_adjustment
        options=pycolmap.BundleAdjustmentOptions()
        options.refine_focal_length=False
        options.refine_principal_point=False
        options.refine_extra_params=False
        options.ceres.loss_function_type=getattr(pycolmap.LossFunctionType,loss)
        options.ceres.loss_function_scale=1
        options.ceres.solver_options.max_num_iterations=150
        options.ceres.solver_options.max_solver_time_in_seconds=60
        options.ceres.solver_options.gradient_tolerance=1e-8
        options.ceres.solver_options.num_threads=4
        pycolmap.bundle_adjustment(model,options)
        output=args.output/loss.lower();output.mkdir();model.write(output)
        result['refinements'][loss]=camera_errors(model,capture)
        (args.output/'refinement.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
