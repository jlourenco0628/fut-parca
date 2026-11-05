const sourceCache = new Map();
let segmenterPromise;
let segmentationQueue = Promise.resolve();

const asset = path => new URL(path, import.meta.url).href;

async function getSegmenter() {
  if (!segmenterPromise) segmenterPromise = import('./vendor/mediapipe/vision_bundle.mjs').then(async ({ FilesetResolver, ImageSegmenter }) => {
    const files = await FilesetResolver.forVisionTasks(asset('./vendor/mediapipe/wasm'));
    return ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: asset('./assets/models/selfie_segmenter.tflite') },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  }).catch(error => {
    segmenterPromise = undefined;
    throw error;
  });
  return segmenterPromise;
}

export function confidenceToAlpha(confidence) {
  if (!Number.isFinite(confidence) || confidence <= .06) return 0;
  if (confidence >= .92) return 255;
  const value = Math.max(0, Math.min(1, (confidence - .06) / .86));
  const smooth = value * value * (3 - 2 * value);
  return Math.round(Math.pow(smooth, .72) * 255);
}

const hasUsefulTransparency = canvas => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(1, Math.floor(data.length / 16000 / 4));
  let samples = 0;
  let transparent = 0;
  for (let index = 3; index < data.length; index += step * 4) {
    samples++;
    if (data[index] < 235) transparent++;
  }
  return samples > 0 && transparent / samples >= .005;
};

const maskCanvas = mask => {
  const confidence = mask.getAsFloat32Array();
  const canvas = document.createElement('canvas');
  canvas.width = mask.width;
  canvas.height = mask.height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(mask.width, mask.height);
  let foreground = 0;
  for (let index = 0; index < confidence.length; index++) {
    const alpha = confidenceToAlpha(confidence[index]);
    const offset = index * 4;
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
    image.data[offset + 3] = alpha;
    if (confidence[index] >= .5) foreground++;
  }
  const ratio = foreground / confidence.length;
  if (ratio < .025 || ratio > .94) throw new Error('Não foi possível reconhecer uma pessoa central nesta foto.');
  context.putImageData(image, 0, 0);
  return canvas;
};

export function alphaBounds(data, width, height, threshold = 8) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= threshold) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return right < left || bottom < top ? null : { left, top, right, bottom };
}

export function paddedCropGeometry(bounds, canvasWidth, canvasHeight) {
  const personWidth = bounds.right - bounds.left + 1;
  const personHeight = bounds.bottom - bounds.top + 1;
  const padX = Math.max(1, Math.round(personWidth * .09));
  const padTop = Math.max(1, Math.round(personHeight * .14));
  const padBottom = Math.max(1, Math.round(personHeight * .025));
  const requestedLeft = bounds.left - padX;
  const requestedTop = bounds.top - padTop;
  const requestedRight = bounds.right + padX;
  const requestedBottom = bounds.bottom + padBottom;
  const sourceLeft = Math.max(0, requestedLeft);
  const sourceTop = Math.max(0, requestedTop);
  const sourceRight = Math.min(canvasWidth - 1, requestedRight);
  const sourceBottom = Math.min(canvasHeight - 1, requestedBottom);
  return {
    outputWidth: requestedRight - requestedLeft + 1,
    outputHeight: requestedBottom - requestedTop + 1,
    sourceLeft,
    sourceTop,
    sourceWidth: sourceRight - sourceLeft + 1,
    sourceHeight: sourceBottom - sourceTop + 1,
    destinationX: sourceLeft - requestedLeft,
    destinationY: sourceTop - requestedTop,
  };
}

const cropToPerson = canvas => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = alphaBounds(pixels.data, canvas.width, canvas.height);
  if (!bounds) throw new Error('Não foi possível recortar a pessoa nesta foto.');
  const geometry = paddedCropGeometry(bounds, canvas.width, canvas.height);
  const cropped = document.createElement('canvas');
  cropped.width = geometry.outputWidth;
  cropped.height = geometry.outputHeight;
  cropped.getContext('2d').drawImage(
    canvas,
    geometry.sourceLeft,
    geometry.sourceTop,
    geometry.sourceWidth,
    geometry.sourceHeight,
    geometry.destinationX,
    geometry.destinationY,
    geometry.sourceWidth,
    geometry.sourceHeight,
  );
  canvas.width = geometry.outputWidth;
  canvas.height = geometry.outputHeight;
  canvas.getContext('2d').drawImage(cropped, 0, 0);
  return canvas;
};

async function segmentCanvas(canvas) {
  const segmenter = await getSegmenter();
  const result = segmenter.segment(canvas);
  try {
    const masks = result.confidenceMasks || [];
    if (masks.length < 1) throw new Error('O recorte automático não retornou a pessoa da foto.');
    const matte = maskCanvas(masks[masks.length - 1]);
    const context = canvas.getContext('2d');
    context.save();
    context.globalCompositeOperation = 'destination-in';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(matte, 0, 0, canvas.width, canvas.height);
    context.restore();
    return cropToPerson(canvas);
  } finally {
    if (typeof result.close === 'function') result.close();
    else {
      result.confidenceMasks?.forEach(mask => mask.close?.());
      result.categoryMask?.close?.();
    }
  }
}

export async function removeBackgroundFromCanvas(canvas) {
  if (hasUsefulTransparency(canvas)) return cropToPerson(canvas);
  const job = segmentationQueue.then(() => segmentCanvas(canvas));
  segmentationQueue = job.catch(() => {});
  return job;
}

const imageFromSource = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Não foi possível preparar o recorte da foto.'));
  image.src = source;
});

export async function cutoutPhotoSource(source) {
  if (!source || !source.startsWith('data:image/')) return source;
  if (sourceCache.has(source)) return sourceCache.get(source);
  const job = imageFromSource(source).then(async image => {
    const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    await removeBackgroundFromCanvas(canvas);
    return canvas.toDataURL('image/webp', .9);
  });
  sourceCache.set(source, job);
  while (sourceCache.size > 12) sourceCache.delete(sourceCache.keys().next().value);
  job.catch(() => sourceCache.delete(source));
  return job;
}

export function enableAutomaticCutouts(root = document) {
  const prepare = image => {
    if (!(image instanceof HTMLImageElement) || !image.matches('[data-fp-cutout]') || image.dataset.fpCutoutState) return;
    image.dataset.fpCutoutState = 'processing';
    cutoutPhotoSource(image.currentSrc || image.src).then(source => {
      if (!image.isConnected) return;
      image.src = source;
      image.dataset.fpCutoutState = 'ready';
      image.closest('.athlete-card__photo')?.classList.add('athlete-card__photo--cutout');
    }).catch(() => { image.dataset.fpCutoutState = 'failed'; });
  };
  root.querySelectorAll?.('[data-fp-cutout]').forEach(prepare);
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (!(node instanceof Element)) return;
    if (node.matches('[data-fp-cutout]')) prepare(node);
    node.querySelectorAll?.('[data-fp-cutout]').forEach(prepare);
  })));
  observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
  return observer;
}
