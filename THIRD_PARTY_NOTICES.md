# Third-party notices

## MNIST-12 ONNX model

- Bundled file: `models/score-recognition/mnist-12.onnx`
- Source: <https://huggingface.co/onnxmodelzoo/mnist-12>
- Upstream documentation: <https://github.com/onnx/models/tree/main/validated/vision/classification/mnist>
- SHA-256: `5c688690f8bacf667d4c2074af5ad0646ca328d7ab03eccf944a65b320171bdd`
- Architecture/training source: CNTK MNIST CNN, published through ONNX Model Zoo.

The Hugging Face model card and ONNX Model Zoo repository identify Apache-2.0 for the distributed model repository; historical model metadata/readme material also carries an MIT designation. This project therefore preserves both notices conservatively instead of silently choosing one label. The Apache-2.0 text is bundled as `third_party/onnx-model-zoo-APACHE-2.0.txt`; the MIT text applicable to the model notice is bundled as `third_party/mnist-12-MIT.txt`.

The upstream 1.1% top-1 error applies to MNIST single-digit classification. It is not a performance claim for this project's segmentation or multi-digit score recognition.

## ONNX Runtime Web 1.20.1

- Package: `onnxruntime-web@1.20.1`
- Source: <https://github.com/microsoft/onnxruntime>
- Delivery: version-pinned jsDelivr script and matching WASM asset base URL.
- License: MIT.

Copyright (c) Microsoft Corporation. The complete license text is bundled as `third_party/onnxruntime-MIT.txt`.

Third-party software is provided by its respective authors without warranty. See the bundled license texts for complete terms.
