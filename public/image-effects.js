/* Display-only processing of rendered SAR thumbnails. Never used for measurements. */
(function (root) {
  'use strict';
  const modes = new Set(['original', 'enhanced', 'simple']);
  const cache = new Map();
  const maxEntries = 24;

  function processPixels(pixels, width, height, mode) {
    if (!modes.has(mode)) throw new Error('Unknown image view.');
    if (pixels.length !== width * height * 4) throw new Error('Invalid image dimensions.');
    const output = new Uint8ClampedArray(pixels.length);
    if (mode === 'original') { output.set(pixels); return output; }
    const smooth = new Float32Array(pixels.length);
    // A small weighted neighborhood softens radar speckle while retaining texture.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (mode === 'simple') {
          let red = 0, green = 0, blue = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const row = Math.max(0, Math.min(height - 1, y + dy)) * width;
            for (let dx = -2; dx <= 2; dx++) {
              const neighbor = (row + Math.max(0, Math.min(width - 1, x + dx))) * 4;
              red += pixels[neighbor]; green += pixels[neighbor + 1]; blue += pixels[neighbor + 2];
            }
          }
          smooth[i] = red / 25; smooth[i + 1] = green / 25; smooth[i + 2] = blue / 25;
          continue;
        }
        const top = (Math.max(0, y - 1) * width + x) * 4;
        const bottom = (Math.min(height - 1, y + 1) * width + x) * 4;
        const left = (y * width + Math.max(0, x - 1)) * 4;
        const right = (y * width + Math.min(width - 1, x + 1)) * 4;
        for (let channel = 0; channel < 3; channel++) {
          smooth[i + channel] = (
            pixels[i + channel] * 4 + pixels[top + channel] + pixels[bottom + channel]
            + pixels[left + channel] + pixels[right + channel]
          ) / 8;
        }
      }
    }
    for (let i = 0; i < pixels.length; i += 4) {
      const r = smooth[i], g = smooth[i + 1], b = smooth[i + 2];
      if (mode === 'enhanced') {
        const luminance = r * .2126 + g * .7152 + b * .0722;
        for (let channel = 0; channel < 3; channel++) {
          const saturated = luminance + (smooth[i + channel] - luminance) * 1.12;
          const contrast = Math.max(0, Math.min(255, (saturated - 128) * 1.12 + 128));
          output[i + channel] = 255 * Math.pow(contrast / 255, .94);
        }
      } else {
        // Color grouping is an interpretation aid, not a land-cover classifier.
        const peak = Math.max(r, g, b);
        let palette;
        if (peak < 48) palette = [83, 147, 190];
        else if (g > r * 1.06 && g > b * .95) palette = [82, 179, 112];
        else if (r > g * 1.08) palette = [219, 177, 111];
        else palette = [158, 169, 167];
        const texture = .5 + (r + g + b) / (3 * 255) * .5;
        for (let channel = 0; channel < 3; channel++) output[i + channel] = palette[channel] * texture;
      }
      output[i + 3] = pixels[i + 3];
    }
    return output;
  }

  function render(url, mode) {
    if (!modes.has(mode)) return Promise.reject(new Error('Unknown image view.'));
    if (mode === 'original') return Promise.resolve(url);
    const key = mode + ':' + url;
    if (cache.has(key)) return cache.get(key).promise;
    const entry = { url: null, promise: null };
    entry.promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onerror = () => reject(new Error('This image could not be loaded for enhancement.'));
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Image processing is unavailable in this browser.');
          context.drawImage(image, 0, 0);
          const data = context.getImageData(0, 0, canvas.width, canvas.height);
          data.data.set(processPixels(data.data, canvas.width, canvas.height, mode));
          context.putImageData(data, 0, 0);
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('Could not create the enhanced image.')); return; }
            if (cache.get(key) !== entry) { reject(new Error('Image processing was cancelled.')); return; }
            entry.url = URL.createObjectURL(blob);
            resolve(entry.url);
          }, 'image/png');
        } catch (error) { reject(error); }
      };
      image.src = url;
    }).catch(error => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      const previous = cache.get(oldest);
      if (previous.url) URL.revokeObjectURL(previous.url);
      cache.delete(oldest);
    }
    return entry.promise;
  }

  function clear() {
    for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
    cache.clear();
  }

  const api = { processPixels, render, clear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SarImageEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
