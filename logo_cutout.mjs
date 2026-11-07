const logoSourceCache = new Map();

const colorDistance = (data, offset, color) => Math.hypot(
  data[offset] - color.r,
  data[offset + 1] - color.g,
  data[offset + 2] - color.b,
);

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const transparentRatio = data => {
  let transparent = 0;
  for (let offset = 3; offset < data.length; offset += 4) if (data[offset] < 235) transparent++;
  return transparent / Math.max(1, data.length / 4);
};

/** Estimate a flat background from the image perimeter without sampling the emblem centre. */
export function estimateEdgeBackground(data, width, height) {
  if (!data || width < 2 || height < 2 || data.length < width * height * 4) return null;
  const offsets = [];
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96));
  const push = (x, y) => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3] > 24) offsets.push(offset);
  };
  for (let x = 0; x < width; x += step) { push(x, 0); push(x, height - 1); }
  for (let y = step; y < height - 1; y += step) { push(0, y); push(width - 1, y); }
  if (offsets.length < 8) return null;
  const color = {
    r: median(offsets.map(offset => data[offset])),
    g: median(offsets.map(offset => data[offset + 1])),
    b: median(offsets.map(offset => data[offset + 2])),
  };
  const matching = offsets.filter(offset => colorDistance(data, offset, color) <= 62);
  const coverage = matching.length / offsets.length;
  if (coverage < .58) return null;
  return { ...color, coverage };
}

/**
 * Remove only background pixels connected to an outer edge. Enclosed light or dark
 * details inside an emblem remain intact even when they match the background colour.
 */
export function removeEdgeConnectedBackground(data, width, height, options = {}) {
  const background = options.background || estimateEdgeBackground(data, width, height);
  if (!background) return { removed: 0, background: null };
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 72;
  const featherTolerance = Number.isFinite(options.featherTolerance) ? options.featherTolerance : 122;
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const originalAlpha = new Uint8Array(pixels);
  let head = 0;
  let tail = 0;
  let originalVisible = 0;

  for (let index = 0; index < pixels; index++) {
    originalAlpha[index] = data[index * 4 + 3];
    if (originalAlpha[index] > 8) originalVisible++;
  }

  const eligible = index => {
    const offset = index * 4;
    return data[offset + 3] <= 16 || colorDistance(data, offset, background) <= tolerance;
  };
  const enqueue = index => {
    if (visited[index] || !eligible(index)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { enqueue(y * width); enqueue(y * width + width - 1); }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  let removed = 0;
  for (let index = 0; index < pixels; index++) {
    if (!visited[index]) continue;
    const alpha = index * 4 + 3;
    if (data[alpha]) removed++;
    data[alpha] = 0;
  }

  // Feather only the first opaque ring around the removed background.
  for (let index = 0; index < pixels; index++) {
    if (visited[index] || data[index * 4 + 3] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    const touchesBackground = (x > 0 && visited[index - 1]) || (x + 1 < width && visited[index + 1]) || (y > 0 && visited[index - width]) || (y + 1 < height && visited[index + width]);
    if (!touchesBackground) continue;
    const offset = index * 4;
    const distance = colorDistance(data, offset, background);
    if (distance >= featherTolerance) continue;
    const alpha = Math.max(0, Math.min(1, (distance - tolerance * .72) / (featherTolerance - tolerance * .72)));
    data[offset + 3] = Math.min(data[offset + 3], Math.round(255 * alpha));
  }

  let remainingVisible = 0;
  for (let index = 0; index < pixels; index++) if (data[index * 4 + 3] > 8) remainingVisible++;
  if (!remainingVisible || remainingVisible / Math.max(1, originalVisible) < .008) {
    for (let index = 0; index < pixels; index++) data[index * 4 + 3] = originalAlpha[index];
    return { removed: 0, background: null };
  }
  return { removed, background };
}

export function logoAlphaBounds(data, width, height, threshold = 8) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] <= threshold) continue;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return right < left || bottom < top ? null : { left, top, right, bottom };
}

export function squareLogoGeometry(bounds) {
  const width = bounds.right - bounds.left + 1;
  const height = bounds.bottom - bounds.top + 1;
  const padding = Math.max(2, Math.ceil(Math.max(width, height) * .1));
  const side = Math.max(width, height) + padding * 2;
  return {
    side,
    sourceX: bounds.left,
    sourceY: bounds.top,
    sourceWidth: width,
    sourceHeight: height,
    destinationX: Math.round((side - width) / 2),
    destinationY: Math.round((side - height) / 2),
  };
}

/** Mutates a browser canvas into a padded, transparent, square emblem. */
export function removeLogoBackgroundFromCanvas(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  if (transparentRatio(image.data) < .005) removeEdgeConnectedBackground(image.data, canvas.width, canvas.height);
  context.putImageData(image, 0, 0);
  const bounds = logoAlphaBounds(image.data, canvas.width, canvas.height);
  if (!bounds) return canvas;
  const geometry = squareLogoGeometry(bounds);
  const cropped = document.createElement('canvas');
  cropped.width = geometry.side;
  cropped.height = geometry.side;
  cropped.getContext('2d').drawImage(
    canvas,
    geometry.sourceX,
    geometry.sourceY,
    geometry.sourceWidth,
    geometry.sourceHeight,
    geometry.destinationX,
    geometry.destinationY,
    geometry.sourceWidth,
    geometry.sourceHeight,
  );
  canvas.width = geometry.side;
  canvas.height = geometry.side;
  canvas.getContext('2d').drawImage(cropped, 0, 0);
  return canvas;
}

const imageFromSource = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Não foi possível preparar o escudo da pelada.'));
  image.src = source;
});

export async function cutoutLogoSource(source) {
  if (!source || !/^(?:data:image\/|blob:|https?:\/\/|\.\.?\/|\/)/i.test(source)) return source;
  if (logoSourceCache.has(source)) return logoSourceCache.get(source);
  const job = imageFromSource(source).then(image => {
    const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    removeLogoBackgroundFromCanvas(canvas);
    return canvas.toDataURL('image/webp', .92);
  });
  logoSourceCache.set(source, job);
  while (logoSourceCache.size > 16) logoSourceCache.delete(logoSourceCache.keys().next().value);
  job.catch(() => logoSourceCache.delete(source));
  return job;
}

export function enableAutomaticLogoCutouts(root = document) {
  const prepare = image => {
    if (!(image instanceof HTMLImageElement) || !image.matches('[data-fp-logo-cutout]') || image.dataset.fpLogoCutoutState) return;
    image.dataset.fpLogoCutoutState = 'processing';
    cutoutLogoSource(image.currentSrc || image.src).then(source => {
      if (!image.isConnected) return;
      image.src = source;
      image.dataset.fpLogoCutoutState = 'ready';
      image.closest('.athlete-card__crest')?.classList.add('athlete-card__crest--cutout');
    }).catch(() => { image.dataset.fpLogoCutoutState = 'failed'; });
  };
  root.querySelectorAll?.('[data-fp-logo-cutout]').forEach(prepare);
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (!(node instanceof Element)) return;
    if (node.matches('[data-fp-logo-cutout]')) prepare(node);
    node.querySelectorAll?.('[data-fp-logo-cutout]').forEach(prepare);
  })));
  observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
  return observer;
}
