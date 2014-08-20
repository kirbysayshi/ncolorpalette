(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

// Polyfill auto attached self to canvas proto if needed.
require('./vendor/canvas-toBlob');

var vash = require('vash');
var GIF = require('gif.js').GIF;

var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');
var fileToImage = require('./lib/fileToImage');

var currentConvergence = null;
var currentGif = null;

var templates = (function() {
  var nodes = document.querySelectorAll('script[type="text/vash"]');
  nodes = [].slice.call(nodes);

  return nodes.reduce(function(tpls, node) {
    tpls[node.id] = vash.compile(node.innerHTML);
    return tpls;
  }, {})
}())

function current() {

  var q = document.querySelector.bind(document);

  // Palettes are rendered separately, might not be there.
  var elPalette = q('[name=options-palettes]:checked');

  return {

    // Defaults/Constants
    ASYNC_AREA_LIMIT: 120000,

    GIF_QUANTIZATION_QUALITY: 10,

    // DOM Options
    palette: elPalette ? palettes[elPalette.value] : null,
    async: q('#options-async').checked,
    asGif: q('#options-as-gif').checked,
    gifTwinkle: parseInt(q('#options-gif-twinkle-delay').value, 10),
    gifFrame: parseInt(q('#options-gif-frame-delay').value, 10),

    paletteWrapper: q('#palette-wrapper'),
    image: q('#img-input'),
    dstCvs: q('#cvs-n-color-rgb'),
    dstImg: q('#img-output'),
    dstCvsGif: q('#cvs-n-color-gif'),
    dstImgGif: q('#img-output-gif'),

    loadingPng: q('#png-loading'),
    loadingGif: q('#gif-loading')
  }
}

function now() {
  return window.performance
    ? window.performance.now()
    : Date.now();
}

current().paletteWrapper.innerHTML = Object.keys(palettes).map(function(id) {
  var palette = palettes[id];
  palette.id = id;
  return templates['tpl-palette'](palette);
}).join('\n');

document.addEventListener('dragenter', function(e) {
  document.body.classList.add('drag-valid');
  e.preventDefault();
}, false);

document.addEventListener('dragover', function(e) {
  document.body.classList.add('drag-valid');
  e.preventDefault();
}, false);

document.addEventListener('dragleave', function(e) {
  document.body.classList.remove('drag-valid');
}, false);

document.addEventListener('drop', function(e) {
  e.preventDefault();
  e.stopPropagation();
  document.body.classList.remove('drag-valid');

  var files = e.dataTransfer.files;

  if (!files[0]) {
    throw new Error('No files or invalid file was dropped.');
  }

  var c = current();
  fileToImage(files[0], c.image, function(err, img) {
    redraw(c);
  })
}, false)

document.querySelector('input[type="file"]').addEventListener('change', function(e) {
  e.stopPropagation();
  var file = e.target.files[0];

  if (!file) {
    throw new Error('No file or invalid file was selected');
  }

  var c = current();
  fileToImage(file, c.image, function(err, img) {
    redraw(c);
  })

}, false)

// Listen to options
document.addEventListener('change', function(e) {
  var c = current();

  if (!c.image.src) return;

  redraw(c);
})

function redraw(opts, opt_cb) {

  if (currentConvergence) {
    // cancel
    currentConvergence();
    currentConvergence = null;
  }

  var srcImg = opts.image;
  var dstCvs = opts.dstCvs;
  var palette = opts.palette;
  var dstCtx = dstCvs.getContext('2d');
  var dstImg = opts.dstImg;

  var srcArea = srcImg.width * srcImg.height;
  var async = srcArea > opts.ASYNC_AREA_LIMIT && opts.async === true
    ? true
    : false;

  // Show loading indicator.
  opts.loadingPng.style.display = 'inline';

  // Make canvas visible to allow for animation.
  dstCvs.style.display = 'block';
  dstImg.style.display = 'none';

  // apply image to canvas
  dstCvs.width = srcImg.width;
  dstCvs.height = srcImg.height;
  dstCtx.drawImage(srcImg, 0, 0);

  // Init clusterer.
  var srcData = dstCtx.getImageData(0, 0, srcImg.width, srcImg.height);
  var dataFactor = 4; // assume rgba for now.
  var clusterCount = palette.pixels.length / dataFactor; // Assume rgba for now.
  var clusterData = Clusterer.init(srcData.data, clusterCount, dataFactor);

  // Init output data.
  var outputImageData = dstCtx.createImageData(srcData);

  var convergeStart = now();
  currentConvergence = converge(clusterData, async, progress, complete);

  function progress(clusterData, convergeCount, pixelsMoved) {
    console.log('converge', convergeCount, async == true ? 'ASYNC' : 'SYNC', pixelsMoved);
    Clusterer.applyPaletteToImageData(clusterData, palette.pixels, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);
  }

  function complete(err, clusterData, convergeCount) {

    var time = now() - convergeStart;

    document.querySelector('#output-stats').textContent =
      '(' + convergeCount + ' iterations, ' + time.toFixed(2) + 'ms)';

    console.log('converged in', convergeCount, time + 'ms');
    Clusterer.applyPaletteToImageData(clusterData, palette.pixels, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);

    dstCvs.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      dstImg.addEventListener('load', function onload() {
        URL.revokeObjectURL(url);
        opts.loadingPng.style.display = 'none';
        dstImg.removeEventListener('load', onload);
      })
      dstImg.src = url;
    })

    if (opts.asGif) {
      doGIF();
    }

    // Hide canvas, show image to allow for dragging out of the browser.
    setTimeout(function() {
      dstCvs.style.display = 'none';
      dstImg.style.display = 'block';

      if (opt_cb) opt_cb.apply(null, arguments);
    })
  }

  function doGIF() {
    opts.loadingGif.style.display = 'inline';

    var dstCvsGif = opts.dstCvsGif;
    var dstCtxGif = dstCvsGif.getContext('2d');
    var dstImgGif = opts.dstImgGif;
    var outputGifImageData = dstCtx.createImageData(outputImageData);

    dstCvsGif.width = outputGifImageData.width;
    dstCvsGif.height = outputGifImageData.height;

    if (currentGif) {
      currentGif.abort();
    }

    currentGif = new GIF({
      workers: palette.pixels.length / 4,
      quality: opts.GIF_QUANTIZATION_QUALITY,
      workerScript: 'vendor/gif.worker.js'
    })

    currentGif.on('finished', function(blob) {
      console.log('gif finished called')
      var url = URL.createObjectURL(blob);
      dstImgGif.addEventListener('load', function onload() {
        URL.revokeObjectURL(url);
        opts.loadingGif.style.display = 'none';
        dstImgGif.removeEventListener('load', onload);
      })
      dstImgGif.src = url;
    })

    var cycledPalette = palette.pixels;

    for (var i = 0; i < palette.pixels.length / 4; i++) {
      cycledPalette = applyThenCyclePalette(clusterData, cycledPalette, outputGifImageData);
      dstCtxGif.putImageData(outputGifImageData, 0, 0);
      currentGif.addFrame(dstCvsGif, {
        copy: true,
        delay: i == 0
          ? opts.gifTwinkle
          : opts.gifFrame
      });
    }

    currentGif.render();
  }
}

function applyThenCyclePalette(clusterData, prevPalette, outputImageData) {
  var cycledPalette = prevPalette.slice(0);
  Clusterer.applyPaletteToImageData(clusterData, cycledPalette, outputImageData);
  var front = cycledPalette.splice(0, 4);
  cycledPalette.push.apply(cycledPalette, front);
  return cycledPalette;
}
},{"./lib/clusterer":3,"./lib/converge":4,"./lib/fileToImage":5,"./lib/palettes":6,"./vendor/canvas-toBlob":14,"gif.js":12,"vash":13}],2:[function(require,module,exports){
function AllocatedArray(maxLength, opt_type) {
  this._length = 0;
  this.data = new (opt_type || Uint32Array)(maxLength);
}

AllocatedArray.prototype.push = function(value) {
  this.data[this._length] = value;
  this._length += 1;
}

AllocatedArray.prototype.length = function() {
  return this._length;
}

AllocatedArray.prototype.remove = function(index) {
  var value = this.data[index];
  this.data[index] = this.data[this._length-1];
  this._length -= 1;
  return value;
}

AllocatedArray.prototype.get = function(index) {
  return this.data[index];
}

module.exports = AllocatedArray;
},{}],3:[function(require,module,exports){

var AArray = require('./allocated-array');

function init(sourceData, clusterCount, dataFactor, opt_meansFn) {

  // Each value in the cluster will point to the index of a value
  // within the sourceData. A.K.A. each cluster is a list of pointers
  // to the "memory" that is the sourceData.
  var clusters = [];
  var maxClusterSize = sourceData.length / dataFactor;
  for (var i = 0; i < clusterCount; i++) {
    clusters.push(new AArray(maxClusterSize));
  }

  var means = opt_meansFn
    ? opt_meansFn(clusterCount, sourceData)
    : defaultInitialMeans(clusterCount, sourceData);

  // Place each pixel into an initial cluster.
  for (var i = 0; i < sourceData.length; i+=4) {
    var target = clusterIndexForPixel(means, sourceData, i);
    clusters[target].push(i);
  }

  return {
    sourceData: sourceData,
    means: means,
    clusters: clusters
  }
}

function step(clusterer) {
  updateMeans(clusterer);
  return updateClusters(clusterer);
}

function updateMeans(clusterer) {
  var means = clusterer.means;
  var clusters = clusterer.clusters;
  var sourceData = clusterer.sourceData;

  clusters.forEach(function(cluster, meanIdx) {
    var r = 0, g = 0, b = 0;

    for (var i = 0; i < cluster.length(); i++) {
      var sourceIdx = cluster.get(i);
      r += sourceData[sourceIdx+0];
      g += sourceData[sourceIdx+1];
      b += sourceData[sourceIdx+2];
    }

    // cluster length of 0 means NaN.
    var meanR = Math.floor(r / cluster.length()) || 0;
    var meanG = Math.floor(g / cluster.length()) || 0;
    var meanB = Math.floor(b / cluster.length()) || 0;

    means[meanIdx*4+0] = meanR;
    means[meanIdx*4+1] = meanG;
    means[meanIdx*4+2] = meanB;
  });
}

function updateClusters(clusterer) {
  var clusters = clusterer.clusters;
  var means = clusterer.means;
  var sourceData = clusterer.sourceData;

  var movementCount = 0;
  for (var i = 0; i < clusters.length; i++) {
    var cluster = clusters[i];
    for (var j = 0; j < cluster.length(); j++) {
      var didx = cluster.get(j);

      var targetClusterIndex = clusterIndexForPixel(means, sourceData, didx);

      if (targetClusterIndex != i) {
        clusters[targetClusterIndex].push(cluster.get(j));
        cluster.remove(j);
        movementCount += 1;
        // If we removed an element from this cluster, ensure we don't skip
        // the next element.
        j--;
      }
    }
  }

  return movementCount;
}

function clusterIndexForPixel(means, sourceData, dataIdx) {
  var min = Number.MAX_VALUE;
  var target = -1;
  for (var i = 0; i < means.length; i += 4) {
    var dist = rgbDist2(
      means[i+0],
      means[i+1],
      means[i+2],

      sourceData[dataIdx+0],
      sourceData[dataIdx+1],
      sourceData[dataIdx+2]
    )

    if (dist < min) {
      min = dist;
      target = i;
    }
  }

  return target / 4;
}

function defaultInitialMeans(clusterCount, sourceData) {
  // TODO: this is vastly simplified than the previous initialization, but
  // results in more iterations required to converge.
  // ?source=PAX-East-2013-Petersens.jpg:
  //   this: 27
  //   previous: 17
  // Perhaps using the mean and then interpolating would be better.

  var means = [];

  for (var i = 0; i < clusterCount; i++) {
    var ratio = i / clusterCount;
    var r = ratio * 255;
    var g = ratio * 255;
    var b = ratio * 255;
    var a = 1;
    means.push(r, g, b, a);
  }

  return means;
}

function rgbDist2(r1, g1, b1, r2, g2, b2) {
  var r = r1 - r2;
  var g = g1 - g2;
  var b = b1 - b2;

  return r*r + g*g + b*b;
}

function applyPaletteToImageData(clusterData, palette, output) {

  var clusters = clusterData.clusters;
  var destData = output.data;

  for (var i = 0; i < clusters.length; i++) {
    var cluster = clusters[i];
    for (var j = 0; j < cluster.length(); j++) {
      var p = cluster.get(j);
      destData[p+0] = palette[i*4+0];
      destData[p+1] = palette[i*4+1];
      destData[p+2] = palette[i*4+2];
      destData[p+3] = palette[i*4+3];
    }
  }

  return output;
}

exports.init = init;
exports.step = step;
exports.applyPaletteToImageData = applyPaletteToImageData;
},{"./allocated-array":2}],4:[function(require,module,exports){
var Clusterer = require('./clusterer');

// Callback is always async.
module.exports = function converger(clusterData, async, opt_progress, cb) {
  var progress = opt_progress;
  if (arguments.length === 3) {
    cb = opt_progress;
    progress = function() {};
  }
  if (async) {
    return asyncConverge(clusterData, progress, cb);
  } else {
    return syncConverge(clusterData, progress, cb);
  }
}

function asyncConverge(clusterData, progress, cb) {
  var convergeCount = 0;
  var canceled = false;

  (function next() {
    setTimeout(function() {
      if (canceled) return;
      convergeCount += 1;
      var moved = Clusterer.step(clusterData);
      if(moved > 0) {
        progress(clusterData, convergeCount, moved);
        next();
      } else {
        cb(null, clusterData, convergeCount);
      }
    }, 0)
  }());

  return function cancel() {
    canceled = true;
  }
}

function syncConverge(clusterData, progress, cb) {
  var moved = 1;
  var convergeCount = 0;

  while (moved > 0) {
    convergeCount += 1;
    moved = Clusterer.step(clusterData);
    progress(clusterData, convergeCount, moved);
  }

  setTimeout(function() {
    cb(null, clusterData, convergeCount);
  })

  return function cancel() {
    // do nothing, it's impossible to cancel a sync convergence.
  }
}
},{"./clusterer":3}],5:[function(require,module,exports){
var exif = require('exif-component');
var exifRotate = require('../vendor/exif-rotate');

module.exports = function(file, img, cb) {

  // First load the file as an image.
  img.onload = onload;
  var url = URL.createObjectURL(file);
  img.src = url;

  function onload(e) {
    URL.revokeObjectURL(url);

    // If we have an orientation index, then rotate.
    orientationIndex(file, function(err, index) {
      if (err) return cb(null, img);

      rotate(img, index, function(err, img) {
        return cb(err, img);
      })
    })
  }
}

// cb(err, loadedImg)
function rotate(img, exifOrientationIndex, cb) {
  if (exifOrientationIndex === -1) {
    return cb(null, img);
  }

  var cvs = exifRotate(img, exifOrientationIndex);
  cvs.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);

    img.onload = function() {
      URL.revokeObjectURL(url);
      cb(null, img);
    }

    img.src = url;
  })
}

// cb(err, exifOrientationIndex)
function orientationIndex(file, cb) {

  var orientationsToIndex = [
    'top-left',
    'top-right',
    'bottom-right',
    'bottom-left',
    'left-top',
    'right-top',
    'right-bottom',
    'left-bottom'
  ];

  var reader = new FileReader();
  reader.readAsArrayBuffer(file);
  reader.addEventListener('loadend', function() {
    try {
      var tags = exif(reader.result);
      var index = orientationsToIndex.indexOf(tags.orientation);
      return cb(null, index > -1 ? index + 1 : index);
    } catch(e) {
      return cb(e);
    }
  })
}
},{"../vendor/exif-rotate":15,"exif-component":10}],6:[function(require,module,exports){

exports.gameboy = {
  name: 'Gameboy',
  pixels: [
    0, 60, 16, 255,
    6, 103, 49, 255,
    123, 180, 0, 255,
    138, 196, 0, 255
  ]
}

exports['special-beam-cannon-cell'] = {
  name: 'Special Beam Cannon (Cell)',
  pixels: [
    0, 0, 60, 255, // deep blue
    83, 13, 65, 255, // purple
    157, 37, 83, 255, // magenta
    //0, 0, 0, 255, // black,
    252, 226, 0, 255 // yellow
  ]
}

exports['special-beam-cannon'] = {
  name: 'Special Beam Cannon (Raditz)',
  pixels: [
    58, 12, 97, 255, // deep purple
    170, 25, 174, 255, // bright purple
    244, 59, 175, 255, // magenta
    254, 251, 83, 255 // yellow
    //254, 251, 231, 255 // white
  ]
}

exports.goku = {
  name: 'Super Saiyan Goku',
  pixels: [
    27, 49, 197, 255, // blue cuffs
    23, 102, 118, 255, // ss iris
    213, 89, 0, 255, // orange gi
    250, 200, 203, 255, // skin
    233, 202, 86, 255, // ss eyebrows
    255, 234, 255, 255 // ss hair highlights
  ]
}

exports.kamehameha = {
  name: "Kame Hame Ha",
  pixels: [
    0, 5, 39, 255, // deep dark blue
    9, 62, 189, 255, // royal blue
    22, 86, 178, 255, // shadow blue
    235, 223, 240, 255, // white blue
    235, 223, 240, 255,
    235, 223, 240, 255
  ]
}

// http://www.colourlovers.com/palette/1652329/Muted_Kirby
exports['muted-kirby'] = {
  name: 'Muted Kirby',
  pixels: [
    34, 42, 79, 255,
    172, 95, 139, 255,
    207, 122, 122, 255,
    251, 217, 216, 255/*,
    255, 255, 255, 255*/
  ]
}
},{}],7:[function(require,module,exports){

},{}],8:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":9}],9:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],10:[function(require,module,exports){

/**
 * Module dependencies.
 */

var ExifReader = require('./js/ExifReader').ExifReader;

/**
 * Parse EXIF tags in `buf`.
 *
 * @param {ArrayBuffer} buf
 * @return {Object}
 * @api public
 */

module.exports = function(buf){
  var exif = new ExifReader;
  exif.load(buf);
  var tags = exif.getAllTags();
  var out = {};

  for(var tag in tags) {
    out[spaces(tag)] = tags[tag].description;
  }

  return out;
};

/**
 * Convert camel-case to lowercase words
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function spaces(str) {
  return str.replace(/([A-Z][a-z])|([a-z][A-Z])|([A-Z])/g, function(m) {
    return (1 == m.length)
      ? m.toLowerCase()
      : (m[0] == m[0].toUpperCase()) ? ' ' + m.toLowerCase() : m[0] + ' ' + m[1].toLowerCase()
  }).replace(/^\s+|\s+$/g, '');
}

},{"./js/ExifReader":11}],11:[function(require,module,exports){
// Generated by CoffeeScript 1.6.2
/*
# ExifReader 1.0.1
# http://github.com/mattiasw/exifreader
# Copyright (C) 2011-2013  Mattias Wallander <mattias@wallander.eu>
# Licensed under the GNU Lesser General Public License version 3 or later
# See license text at http://www.gnu.org/licenses/lgpl.txt
*/


(function() {
  (typeof exports !== "undefined" && exports !== null ? exports : this).ExifReader = (function() {
    ExifReader.prototype._MIN_DATA_BUFFER_LENGTH = 2;

    ExifReader.prototype._JPEG_ID_SIZE = 2;

    ExifReader.prototype._JPEG_ID = 0xffd8;

    ExifReader.prototype._APP_MARKER_SIZE = 2;

    ExifReader.prototype._APP0_MARKER = 0xffe0;

    ExifReader.prototype._APP1_MARKER = 0xffe1;

    ExifReader.prototype._APP15_MARKER = 0xffef;

    ExifReader.prototype._APP_ID_OFFSET = 4;

    ExifReader.prototype._BYTES_Exif = 0x45786966;

    ExifReader.prototype._TIFF_HEADER_OFFSET = 10;

    ExifReader.prototype._BYTE_ORDER_BIG_ENDIAN = 0x4949;

    ExifReader.prototype._BYTE_ORDER_LITTLE_ENDIAN = 0x4d4d;

    function ExifReader() {
      var _this = this;

      this._getTagValueAt = {
        1: function(offset) {
          return _this._getByteAt(offset);
        },
        2: function(offset) {
          return _this._getAsciiAt(offset);
        },
        3: function(offset) {
          return _this._getShortAt(offset);
        },
        4: function(offset) {
          return _this._getLongAt(offset);
        },
        5: function(offset) {
          return _this._getRationalAt(offset);
        },
        7: function(offset) {
          return _this._getUndefinedAt(offset);
        },
        9: function(offset) {
          return _this._getSlongAt(offset);
        },
        10: function(offset) {
          return _this._getSrationalAt(offset);
        }
      };
      this._tiffHeaderOffset = 0;
    }

    /*
    # Loads all the Exif tags from the specified image file buffer.
    #
    # data ArrayBuffer Image file data
    */


    ExifReader.prototype.load = function(data) {
      return this.loadView(new DataView(data));
    };

    /*
    # Loads all the Exif tags from the specified image file buffer view. Probably
    # used when DataView isn't supported by the browser.
    #
    # @_dataView DataView Image file data view
    */


    ExifReader.prototype.loadView = function(_dataView) {
      this._dataView = _dataView;
      this._tags = {};
      this._checkImageHeader();
      return this._readTags();
    };

    ExifReader.prototype._checkImageHeader = function() {
      var dataView;

      dataView = this._dataView;
      if (dataView.byteLength < this._MIN_DATA_BUFFER_LENGTH || dataView.getUint16(0, false) !== this._JPEG_ID) {
        throw new Error('Invalid image format');
      }
      this._parseAppMarkers(dataView);
      if (!this._hasExifData()) {
        throw new Error('No Exif data');
      }
    };

    ExifReader.prototype._parseAppMarkers = function(dataView) {
      var appMarkerPosition, fieldLength, _results;

      appMarkerPosition = this._JPEG_ID_SIZE;
      _results = [];
      while (true) {
        if (dataView.byteLength < appMarkerPosition + this._APP_ID_OFFSET + 5) {
          break;
        }
        if (this._isApp1ExifMarker(dataView, appMarkerPosition)) {
          fieldLength = dataView.getUint16(appMarkerPosition + this._APP_MARKER_SIZE, false);
          this._tiffHeaderOffset = appMarkerPosition + this._TIFF_HEADER_OFFSET;
        } else if (this._isAppMarker(dataView, appMarkerPosition)) {
          fieldLength = dataView.getUint16(appMarkerPosition + this._APP_MARKER_SIZE, false);
        } else {
          break;
        }
        _results.push(appMarkerPosition += this._APP_MARKER_SIZE + fieldLength);
      }
      return _results;
    };

    ExifReader.prototype._isApp1ExifMarker = function(dataView, appMarkerPosition) {
      return dataView.getUint16(appMarkerPosition, false) === this._APP1_MARKER && dataView.getUint32(appMarkerPosition + this._APP_ID_OFFSET, false) === this._BYTES_Exif && dataView.getUint8(appMarkerPosition + this._APP_ID_OFFSET + 4, false) === 0x00;
    };

    ExifReader.prototype._isAppMarker = function(dataView, appMarkerPosition) {
      var appMarker;

      appMarker = dataView.getUint16(appMarkerPosition, false);
      return appMarker >= this._APP0_MARKER && appMarker <= this._APP15_MARKER;
    };

    ExifReader.prototype._hasExifData = function() {
      return this._tiffHeaderOffset !== 0;
    };

    ExifReader.prototype._readTags = function() {
      this._setByteOrder();
      this._read0thIfd();
      this._readExifIfd();
      this._readGpsIfd();
      return this._readInteroperabilityIfd();
    };

    ExifReader.prototype._setByteOrder = function() {
      if (this._dataView.getUint16(this._tiffHeaderOffset) === this._BYTE_ORDER_BIG_ENDIAN) {
        return this._littleEndian = true;
      } else if (this._dataView.getUint16(this._tiffHeaderOffset) === this._BYTE_ORDER_LITTLE_ENDIAN) {
        return this._littleEndian = false;
      } else {
        throw new Error('Illegal byte order value. Faulty image.');
      }
    };

    ExifReader.prototype._read0thIfd = function() {
      var ifdOffset;

      ifdOffset = this._getIfdOffset();
      return this._readIfd('0th', ifdOffset);
    };

    ExifReader.prototype._getIfdOffset = function() {
      return this._tiffHeaderOffset + this._getLongAt(this._tiffHeaderOffset + 4);
    };

    ExifReader.prototype._readExifIfd = function() {
      var ifdOffset;

      if (this._tags['Exif IFD Pointer'] != null) {
        ifdOffset = this._tiffHeaderOffset + this._tags['Exif IFD Pointer'].value;
        return this._readIfd('exif', ifdOffset);
      }
    };

    ExifReader.prototype._readGpsIfd = function() {
      var ifdOffset;

      if (this._tags['GPS Info IFD Pointer'] != null) {
        ifdOffset = this._tiffHeaderOffset + this._tags['GPS Info IFD Pointer'].value;
        return this._readIfd('gps', ifdOffset);
      }
    };

    ExifReader.prototype._readInteroperabilityIfd = function() {
      var ifdOffset;

      if (this._tags['Interoperability IFD Pointer'] != null) {
        ifdOffset = this._tiffHeaderOffset + this._tags['Interoperability IFD Pointer'].value;
        return this._readIfd('interoperability', ifdOffset);
      }
    };

    ExifReader.prototype._readIfd = function(ifdType, offset) {
      var fieldIndex, numberOfFields, tag, _i, _results;

      numberOfFields = this._getShortAt(offset);
      offset += 2;
      _results = [];
      for (fieldIndex = _i = 0; 0 <= numberOfFields ? _i < numberOfFields : _i > numberOfFields; fieldIndex = 0 <= numberOfFields ? ++_i : --_i) {
        tag = this._readTag(ifdType, offset);
        this._tags[tag.name] = {
          'value': tag.value,
          'description': tag.description
        };
        _results.push(offset += 12);
      }
      return _results;
    };

    ExifReader.prototype._readTag = function(ifdType, offset) {
      var tagCode, tagCount, tagDescription, tagName, tagType, tagValue, tagValueOffset;

      tagCode = this._getShortAt(offset);
      tagType = this._getShortAt(offset + 2);
      tagCount = this._getLongAt(offset + 4);
      if (this._typeSizes[tagType] * tagCount <= 4) {
        tagValue = this._getTagValue(offset + 8, tagType, tagCount);
      } else {
        tagValueOffset = this._getLongAt(offset + 8);
        tagValue = this._getTagValue(this._tiffHeaderOffset + tagValueOffset, tagType, tagCount);
      }
      if (tagType === this._tagTypes['ASCII']) {
        tagValue = this._splitNullSeparatedAsciiString(tagValue);
      }
      if (this._tagNames[ifdType][tagCode] != null) {
        if ((this._tagNames[ifdType][tagCode]['name'] != null) && (this._tagNames[ifdType][tagCode]['description'] != null)) {
          tagName = this._tagNames[ifdType][tagCode]['name'];
          tagDescription = this._tagNames[ifdType][tagCode]['description'](tagValue);
        } else {
          tagName = this._tagNames[ifdType][tagCode];
          if (tagValue instanceof Array) {
            tagDescription = tagValue.join(', ');
          } else {
            tagDescription = tagValue;
          }
        }
        return {
          'name': tagName,
          'value': tagValue,
          'description': tagDescription
        };
      } else {
        return {
          'name': "undefined-" + tagCode,
          'value': tagValue,
          'description': tagValue
        };
      }
    };

    ExifReader.prototype._getTagValue = function(offset, type, count) {
      var tagValue, value, valueIndex;

      value = (function() {
        var _i, _results;

        _results = [];
        for (valueIndex = _i = 0; 0 <= count ? _i < count : _i > count; valueIndex = 0 <= count ? ++_i : --_i) {
          tagValue = this._getTagValueAt[type](offset);
          offset += this._typeSizes[type];
          _results.push(tagValue);
        }
        return _results;
      }).call(this);
      if (value.length === 1) {
        value = value[0];
      } else if (type === this._tagTypes['ASCII']) {
        value = this._getAsciiValue(value);
      }
      return value;
    };

    ExifReader.prototype._getAsciiValue = function(charArray) {
      var charCode, newCharArray;

      return newCharArray = (function() {
        var _i, _len, _results;

        _results = [];
        for (_i = 0, _len = charArray.length; _i < _len; _i++) {
          charCode = charArray[_i];
          _results.push(String.fromCharCode(charCode));
        }
        return _results;
      })();
    };

    ExifReader.prototype._getByteAt = function(offset) {
      return this._dataView.getUint8(offset);
    };

    ExifReader.prototype._getAsciiAt = function(offset) {
      return this._dataView.getUint8(offset);
    };

    ExifReader.prototype._getShortAt = function(offset) {
      return this._dataView.getUint16(offset, this._littleEndian);
    };

    ExifReader.prototype._getLongAt = function(offset) {
      return this._dataView.getUint32(offset, this._littleEndian);
    };

    ExifReader.prototype._getRationalAt = function(offset) {
      return this._getLongAt(offset) / this._getLongAt(offset + 4);
    };

    ExifReader.prototype._getUndefinedAt = function(offset) {
      return this._getByteAt(offset);
    };

    ExifReader.prototype._getSlongAt = function(offset) {
      return this._dataView.getInt32(offset, this._littleEndian);
    };

    ExifReader.prototype._getSrationalAt = function(offset) {
      return this._getSlongAt(offset) / this._getSlongAt(offset + 4);
    };

    ExifReader.prototype._splitNullSeparatedAsciiString = function(string) {
      var character, i, tagValue, _i, _len;

      tagValue = [];
      i = 0;
      for (_i = 0, _len = string.length; _i < _len; _i++) {
        character = string[_i];
        if (character === '\x00') {
          i++;
          continue;
        }
        if (tagValue[i] == null) {
          tagValue[i] = '';
        }
        tagValue[i] += character;
      }
      return tagValue;
    };

    ExifReader.prototype._typeSizes = {
      1: 1,
      2: 1,
      3: 2,
      4: 4,
      5: 8,
      7: 1,
      9: 4,
      10: 8
    };

    ExifReader.prototype._tagTypes = {
      'BYTE': 1,
      'ASCII': 2,
      'SHORT': 3,
      'LONG': 4,
      'RATIONAL': 5,
      'UNDEFINED': 7,
      'SLONG': 9,
      'SRATIONAL': 10
    };

    ExifReader.prototype._tagNames = {
      '0th': {
        0x0100: 'ImageWidth',
        0x0101: 'ImageLength',
        0x0102: 'BitsPerSample',
        0x0103: 'Compression',
        0x0106: 'PhotometricInterpretation',
        0x010e: 'ImageDescription',
        0x010f: 'Make',
        0x0110: 'Model',
        0x0111: 'StripOffsets',
        0x0112: {
          'name': 'Orientation',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'top-left';
              case 2:
                return 'top-right';
              case 3:
                return 'bottom-right';
              case 4:
                return 'bottom-left';
              case 5:
                return 'left-top';
              case 6:
                return 'right-top';
              case 7:
                return 'right-bottom';
              case 8:
                return 'left-bottom';
              default:
                return 'Undefined';
            }
          }
        },
        0x0115: 'SamplesPerPixel',
        0x0116: 'RowsPerStrip',
        0x0117: 'StripByteCounts',
        0x011a: 'XResolution',
        0x011b: 'YResolution',
        0x011c: 'PlanarConfiguration',
        0x0128: {
          'name': 'ResolutionUnit',
          'description': function(value) {
            switch (value) {
              case 2:
                return 'inches';
              case 3:
                return 'centimeters';
              default:
                return 'Unknown';
            }
          }
        },
        0x012d: 'TransferFunction',
        0x0131: 'Software',
        0x0132: 'DateTime',
        0x013b: 'Artist',
        0x013e: 'WhitePoint',
        0x013f: 'PrimaryChromaticities',
        0x0201: 'JPEGInterchangeFormat',
        0x0202: 'JPEGInterchangeFormatLength',
        0x0211: 'YCbCrCoefficients',
        0x0212: 'YCbCrSubSampling',
        0x0213: {
          'name': 'YCbCrPositioning',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'centered';
              case 2:
                return 'co-sited';
              default:
                return 'undefied ' + value;
            }
          }
        },
        0x0214: 'ReferenceBlackWhite',
        0x8298: {
          'name': 'Copyright',
          'description': function(value) {
            return value.join('; ');
          }
        },
        0x8769: 'Exif IFD Pointer',
        0x8825: 'GPS Info IFD Pointer'
      },
      'exif': {
        0x829a: 'ExposureTime',
        0x829d: 'FNumber',
        0x8822: {
          'name': 'ExposureProgram',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Undefined';
              case 1:
                return 'Manual';
              case 2:
                return 'Normal program';
              case 3:
                return 'Aperture priority';
              case 4:
                return 'Shutter priority';
              case 5:
                return 'Creative program';
              case 6:
                return 'Action program';
              case 7:
                return 'Portrait mode';
              case 8:
                return 'Landscape mode';
              default:
                return 'Unknown';
            }
          }
        },
        0x8824: 'SpectralSensitivity',
        0x8827: 'ISOSpeedRatings',
        0x8828: {
          'name': 'OECF',
          'description': function(value) {
            return '[Raw OECF table data]';
          }
        },
        0x9000: {
          'name': 'ExifVersion',
          'description': function(value) {
            var charCode, string, _i, _len;

            string = '';
            for (_i = 0, _len = value.length; _i < _len; _i++) {
              charCode = value[_i];
              string += String.fromCharCode(charCode);
            }
            return string;
          }
        },
        0x9003: 'DateTimeOriginal',
        0x9004: 'DateTimeDigitized',
        0x9101: {
          'name': 'ComponentsConfiguration',
          'description': function(value) {
            var character, string, _i, _len;

            string = '';
            for (_i = 0, _len = value.length; _i < _len; _i++) {
              character = value[_i];
              switch (character) {
                case 0x31:
                  string += 'Y';
                  break;
                case 0x32:
                  string += 'Cb';
                  break;
                case 0x33:
                  string += 'Cr';
                  break;
                case 0x34:
                  string += 'R';
                  break;
                case 0x35:
                  string += 'G';
                  break;
                case 0x36:
                  string += 'B';
              }
            }
            return string;
          }
        },
        0x9102: 'CompressedBitsPerPixel',
        0x9201: 'ShutterSpeedValue',
        0x9202: 'ApertureValue',
        0x9203: 'BrightnessValue',
        0x9204: 'ExposureBiasValue',
        0x9205: 'MaxApertureValue',
        0x9206: 'SubjectDistance',
        0x9207: {
          'name': 'MeteringMode',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'Average';
              case 2:
                return 'CenterWeightedAverage';
              case 3:
                return 'Spot';
              case 4:
                return 'MultiSpot';
              case 5:
                return 'Pattern';
              case 6:
                return 'Partial';
              case 255:
                return 'Other';
              default:
                return 'Unknown';
            }
          }
        },
        0x9208: {
          'name': 'LightSource',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'Daylight';
              case 2:
                return 'Fluorescent';
              case 3:
                return 'Tungsten (incandescent light)';
              case 4:
                return 'Flash';
              case 9:
                return 'Fine weather';
              case 10:
                return 'Cloudy weather';
              case 11:
                return 'Shade';
              case 12:
                return 'Daylight fluorescent (D 5700 – 7100K)';
              case 13:
                return 'Day white fluorescent (N 4600 – 5400K)';
              case 14:
                return 'Cool white fluorescent (W 3900 – 4500K)';
              case 15:
                return 'White fluorescent (WW 3200 – 3700K)';
              case 17:
                return 'Standard light A';
              case 18:
                return 'Standard light B';
              case 19:
                return 'Standard light C';
              case 20:
                return 'D55';
              case 21:
                return 'D65';
              case 22:
                return 'D75';
              case 23:
                return 'D50';
              case 24:
                return 'ISO studio tungsten';
              case 255:
                return 'Other light source';
              default:
                return 'Unknown';
            }
          }
        },
        0x9209: {
          'name': 'Flash',
          'description': function(value) {
            switch (value) {
              case 0x00:
                return 'Flash did not fire';
              case 0x01:
                return 'Flash fired';
              case 0x05:
                return 'Strobe return light not detected';
              case 0x07:
                return 'Strobe return light detected';
              case 0x09:
                return 'Flash fired, compulsory flash mode';
              case 0x0d:
                return 'Flash fired, compulsory flash mode, return light not detected';
              case 0x0f:
                return 'Flash fired, compulsory flash mode, return light detected';
              case 0x10:
                return 'Flash did not fire, compulsory flash mode';
              case 0x18:
                return 'Flash did not fire, auto mode';
              case 0x19:
                return 'Flash fired, auto mode';
              case 0x1d:
                return 'Flash fired, auto mode, return light not detected';
              case 0x1f:
                return 'Flash fired, auto mode, return light detected';
              case 0x20:
                return 'No flash function';
              case 0x41:
                return 'Flash fired, red-eye reduction mode';
              case 0x45:
                return 'Flash fired, red-eye reduction mode, return light not detected';
              case 0x47:
                return 'Flash fired, red-eye reduction mode, return light detected';
              case 0x49:
                return 'Flash fired, compulsory flash mode, red-eye reduction mode';
              case 0x4d:
                return 'Flash fired, compulsory flash mode, red-eye reduction mode, return light not detected';
              case 0x4f:
                return 'Flash fired, compulsory flash mode, red-eye reduction mode, return light detected';
              case 0x59:
                return 'Flash fired, auto mode, red-eye reduction mode';
              case 0x5d:
                return 'Flash fired, auto mode, return light not detected, red-eye reduction mode';
              case 0x5f:
                return 'Flash fired, auto mode, return light detected, red-eye reduction mode';
              default:
                return 'Unknown';
            }
          }
        },
        0x920a: 'FocalLength',
        0x9214: {
          'name': 'SubjectArea',
          'description': function(value) {
            switch (value.length) {
              case 2:
                return "Location; X: " + value[0] + ", Y: " + value[1];
              case 3:
                return "Circle; X: " + value[0] + ", Y: " + value[1] + ", diameter: " + value[2];
              case 4:
                return "Rectangle; X: " + value[0] + ", Y: " + value[1] + ", width: " + value[2] + ", height: " + value[3];
              default:
                return 'Unknown';
            }
          }
        },
        0x927c: {
          'name': 'MakerNote',
          'description': function(value) {
            return '[Raw maker note data]';
          }
        },
        0x9286: {
          'name': 'UserComment',
          'description': function(value) {
            switch (value.slice(0, 8).map(function(charCode) {
                  return String.fromCharCode(charCode);
                }).join('')) {
              case 'ASCII\x00\x00\x00':
                return value.slice(8, value.length).map(function(charCode) {
                  return String.fromCharCode(charCode);
                }).join('');
              case 'JIS\x00\x00\x00\x00\x00':
                return '[JIS encoded text]';
              case 'UNICODE\x00':
                return '[Unicode encoded text]';
              case '\x00\x00\x00\x00\x00\x00\x00\x00':
                return '[Undefined encoding]';
            }
          }
        },
        0x9290: 'SubSecTime',
        0x9291: 'SubSecTimeOriginal',
        0x9292: 'SubSecTimeDigitized',
        0xa000: {
          'name': 'FlashpixVersion',
          'description': function(value) {
            var charCode, string, _i, _len;

            string = '';
            for (_i = 0, _len = value.length; _i < _len; _i++) {
              charCode = value[_i];
              string += String.fromCharCode(charCode);
            }
            return string;
          }
        },
        0xa001: {
          'name': 'ColorSpace',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'sRGB';
              case 0xffff:
                return 'Uncalibrated';
              default:
                return 'Unknown';
            }
          }
        },
        0xa002: 'PixelXDimension',
        0xa003: 'PixelYDimension',
        0xa004: 'RelatedSoundFile',
        0xa005: 'Interoperability IFD Pointer',
        0xa20b: 'FlashEnergy',
        0xa20c: {
          'name': 'SpatialFrequencyResponse',
          'description': function(value) {
            return '[Raw SFR table data]';
          }
        },
        0xa20e: 'FocalPlaneXResolution',
        0xa20f: 'FocalPlaneYResolution',
        0xa210: {
          'name': 'FocalPlaneResolutionUnit',
          'description': function(value) {
            switch (value) {
              case 2:
                return 'inches';
              case 3:
                return 'centimeters';
              default:
                return 'Unknown';
            }
          }
        },
        0xa214: {
          'name': 'SubjectLocation',
          'description': function(value) {
            return "X: " + value[0] + ", Y: " + value[1];
          }
        },
        0xa215: 'ExposureIndex',
        0xa217: {
          'name': 'SensingMethod',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'Undefined';
              case 2:
                return 'One-chip color area sensor';
              case 3:
                return 'Two-chip color area sensor';
              case 4:
                return 'Three-chip color area sensor';
              case 5:
                return 'Color sequential area sensor';
              case 7:
                return 'Trilinear sensor';
              case 8:
                return 'Color sequential linear sensor';
              default:
                return 'Unknown';
            }
          }
        },
        0xa300: {
          'name': 'FileSource',
          'description': function(value) {
            switch (value) {
              case 3:
                return 'DSC';
              default:
                return 'Unknown';
            }
          }
        },
        0xa301: {
          'name': 'SceneType',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'A directly photographed image';
              default:
                return 'Unknown';
            }
          }
        },
        0xa302: {
          'name': 'CFAPattern',
          'description': function(value) {
            return '[Raw CFA pattern table data]';
          }
        },
        0xa401: {
          'name': 'CustomRendered',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Normal process';
              case 1:
                return 'Custom process';
              default:
                return 'Unknown';
            }
          }
        },
        0xa402: {
          'name': 'ExposureMode',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Auto exposure';
              case 1:
                return 'Manual exposure';
              case 2:
                return 'Auto bracket';
              default:
                return 'Unknown';
            }
          }
        },
        0xa403: {
          'name': 'WhiteBalance',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Auto white balance';
              case 1:
                return 'Manual white balance';
              default:
                return 'Unknown';
            }
          }
        },
        0xa404: {
          'name': 'DigitalZoomRatio',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Digital zoom was not used';
              default:
                return value;
            }
          }
        },
        0xa405: {
          'name': 'FocalLengthIn35mmFilm',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Unknown';
              default:
                return value;
            }
          }
        },
        0xa406: {
          'name': 'SceneCaptureType',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Standard';
              case 1:
                return 'Landscape';
              case 2:
                return 'Portrait';
              case 3:
                return 'Night scene';
              default:
                return 'Unknown';
            }
          }
        },
        0xa407: {
          'name': 'GainControl',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'None';
              case 1:
                return 'Low gain up';
              case 2:
                return 'High gain up';
              case 3:
                return 'Low gain down';
              case 4:
                return 'High gain down';
              default:
                return 'Unknown';
            }
          }
        },
        0xa408: {
          'name': 'Contrast',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Normal';
              case 1:
                return 'Soft';
              case 2:
                return 'Hard';
              default:
                return 'Unknown';
            }
          }
        },
        0xa409: {
          'name': 'Saturation',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Normal';
              case 1:
                return 'Low saturation';
              case 2:
                return 'High saturation';
              default:
                return 'Unknown';
            }
          }
        },
        0xa40a: {
          'name': 'Sharpness',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Normal';
              case 1:
                return 'Soft';
              case 2:
                return 'Hard';
              default:
                return 'Unknown';
            }
          }
        },
        0xa40b: {
          'name': 'DeviceSettingDescription',
          'description': function(value) {
            return '[Raw device settings table data]';
          }
        },
        0xa40c: {
          'name': 'SubjectDistanceRange',
          'description': function(value) {
            switch (value) {
              case 1:
                return 'Macro';
              case 2:
                return 'Close view';
              case 3:
                return 'Distant view';
              default:
                return 'Unknown';
            }
          }
        },
        0xa420: 'ImageUniqueID'
      },
      'gps': {
        0x0000: {
          'name': 'GPSVersionID',
          'description': function(value) {
            var _ref, _ref1;

            if ((value[0] === (_ref = value[1]) && _ref === 2) && (value[2] === (_ref1 = value[3]) && _ref1 === 0)) {
              return 'Version 2.2';
            } else {
              return 'Unknown';
            }
          }
        },
        0x0001: {
          'name': 'GPSLatitudeRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'N':
                return 'North latitude';
              case 'S':
                return 'South latitude';
              default:
                return 'Unknown';
            }
          }
        },
        0x0002: {
          'name': 'GPSLatitude',
          'description': function(value) {
            return value[0] + value[1] / 60 + value[2] / 3600;
          }
        },
        0x0003: {
          'name': 'GPSLongitudeRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'E':
                return 'East longitude';
              case 'W':
                return 'West longitude';
              default:
                return 'Unknown';
            }
          }
        },
        0x0004: {
          'name': 'GPSLongitude',
          'description': function(value) {
            return value[0] + value[1] / 60 + value[2] / 3600;
          }
        },
        0x0005: {
          'name': 'GPSAltitudeRef',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Sea level';
              case 1:
                return 'Sea level reference (negative value)';
              default:
                return 'Unknown';
            }
          }
        },
        0x0006: {
          'name': 'GPSAltitude',
          'description': function(value) {
            return value + ' m';
          }
        },
        0x0007: {
          'name': 'GPSTimeStamp',
          'description': function(value) {
            var padZero;

            padZero = function(num) {
              var i;

              return ((function() {
                var _i, _ref, _results;

                _results = [];
                for (i = _i = 0, _ref = 2 - ('' + Math.floor(num)).length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
                  _results.push('0');
                }
                return _results;
              })()) + num;
            };
            return value.map(padZero).join(':');
          }
        },
        0x0008: 'GPSSatellites',
        0x0009: {
          'name': 'GPSStatus',
          'description': function(value) {
            switch (value.join('')) {
              case 'A':
                return 'Measurement in progress';
              case 'V':
                return 'Measurement Interoperability';
              default:
                return 'Unknown';
            }
          }
        },
        0x000a: {
          'name': 'GPSMeasureMode',
          'description': function(value) {
            switch (value.join('')) {
              case '2':
                return '2-dimensional measurement';
              case '3':
                return '3-dimensional measurement';
              default:
                return 'Unknown';
            }
          }
        },
        0x000b: 'GPSDOP',
        0x000c: {
          'name': 'GPSSpeedRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'K':
                return 'Kilometers per hour';
              case 'M':
                return 'Miles per hour';
              case 'N':
                return 'Knots';
              default:
                return 'Unknown';
            }
          }
        },
        0x000d: 'GPSSpeed',
        0x000e: {
          'name': 'GPSTrackRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'T':
                return 'True direction';
              case 'M':
                return 'Magnetic direction';
              default:
                return 'Unknown';
            }
          }
        },
        0x000f: 'GPSTrack',
        0x0010: {
          'name': 'GPSImgDirectionRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'T':
                return 'True direction';
              case 'M':
                return 'Magnetic direction';
              default:
                return 'Unknown';
            }
          }
        },
        0x0011: 'GPSImgDirection',
        0x0012: 'GPSMapDatum',
        0x0013: {
          'name': 'GPSDestLatitudeRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'N':
                return 'North latitude';
              case 'S':
                return 'South latitude';
              default:
                return 'Unknown';
            }
          }
        },
        0x0014: {
          'name': 'GPSDestLatitude',
          'description': function(value) {
            return value[0] + value[1] / 60 + value[2] / 3600;
          }
        },
        0x0015: {
          'name': 'GPSDestLongitudeRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'E':
                return 'East longitude';
              case 'W':
                return 'West longitude';
              default:
                return 'Unknown';
            }
          }
        },
        0x0016: {
          'name': 'GPSDestLongitude',
          'description': function(value) {
            return value[0] + value[1] / 60 + value[2] / 3600;
          }
        },
        0x0017: {
          'name': 'GPSDestBearingRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'T':
                return 'True direction';
              case 'M':
                return 'Magnetic direction';
              default:
                return 'Unknown';
            }
          }
        },
        0x0018: 'GPSDestBearing',
        0x0019: {
          'name': 'GPSDestDistanceRef',
          'description': function(value) {
            switch (value.join('')) {
              case 'K':
                return 'Kilometers';
              case 'M':
                return 'Miles';
              case 'N':
                return 'Knots';
              default:
                return 'Unknown';
            }
          }
        },
        0x001a: 'GPSDestDistance',
        0x001b: {
          'name': 'GPSProcessingMethod',
          'description': function(value) {
            switch (value.slice(0, 8).map(function(charCode) {
                  return String.fromCharCode(charCode);
                }).join('')) {
              case 'ASCII\x00\x00\x00':
                return value.slice(8, value.length).map(function(charCode) {
                  return String.fromCharCode(charCode);
                }).join('');
              case 'JIS\x00\x00\x00\x00\x00':
                return '[JIS encoded text]';
              case 'UNICODE\x00':
                return '[Unicode encoded text]';
              case '\x00\x00\x00\x00\x00\x00\x00\x00':
                return '[Undefined encoding]';
            }
          }
        },
        0x001c: {
          'name': 'GPSAreaInformation',
          'description': function(value) {
            switch (value.slice(0, 8).map(function(charCode) {
                  return String.fromCharCode(charCode);
                }).join('')) {
              case 'ASCII\x00\x00\x00':
                return value.slice(8, value.length).map(function(charCode) {
                  return String.fromCharCode(charCode);
                }).join('');
              case 'JIS\x00\x00\x00\x00\x00':
                return '[JIS encoded text]';
              case 'UNICODE\x00':
                return '[Unicode encoded text]';
              case '\x00\x00\x00\x00\x00\x00\x00\x00':
                return '[Undefined encoding]';
            }
          }
        },
        0x001d: 'GPSDateStamp',
        0x001e: {
          'name': 'GPSDifferential',
          'description': function(value) {
            switch (value) {
              case 0:
                return 'Measurement without differential correction';
              case 1:
                return 'Differential correction applied';
              default:
                return 'Unknown';
            }
          }
        }
      },
      'interoperability': {
        0x0001: 'InteroperabilityIndex',
        0x0002: 'UnknownInteroperabilityTag0x0002',
        0x1001: 'UnknownInteroperabilityTag0x1001',
        0x1002: 'UnknownInteroperabilityTag0x1002'
      }
    };

    /*
    # Gets the image's value of the tag with the given name.
    #
    # name string The name of the tag to get the value of
    #
    # Returns the value of the tag with the given name if it exists,
    # otherwise throws "Undefined".
    */


    ExifReader.prototype.getTagValue = function(name) {
      if (this._tags[name] != null) {
        return this._tags[name].value;
      } else {
        return void 0;
      }
    };

    /*
    # Gets the image's description of the tag with the given name.
    #
    # name string The name of the tag to get the description of
    #
    # Returns the description of the tag with the given name if it exists,
    # otherwise throws "Undefined".
    */


    ExifReader.prototype.getTagDescription = function(name) {
      if (this._tags[name] != null) {
        return this._tags[name].description;
      } else {
        return void 0;
      }
    };

    /*
    # Gets all the image's tags.
    #
    # Returns the image's tags as an associative array: name -> description.
    */


    ExifReader.prototype.getAllTags = function() {
      return this._tags;
    };

    return ExifReader;

  })();

}).call(this);

},{}],12:[function(require,module,exports){
(function(c){function a(b,d){if({}.hasOwnProperty.call(a.cache,b))return a.cache[b];var e=a.resolve(b);if(!e)throw new Error('Failed to resolve module '+b);var c={id:b,require:a,filename:b,exports:{},loaded:!1,parent:d,children:[]};d&&d.children.push(c);var f=b.slice(0,b.lastIndexOf('/')+1);return a.cache[b]=c.exports,e.call(c.exports,c,c.exports,f,b),c.loaded=!0,a.cache[b]=c.exports}a.modules={},a.cache={},a.resolve=function(b){return{}.hasOwnProperty.call(a.modules,b)?a.modules[b]:void 0},a.define=function(b,c){a.modules[b]=c};var b=function(a){return a='/',{title:'browser',version:'v0.10.26',browser:!0,env:{},argv:[],nextTick:c.setImmediate||function(a){setTimeout(a,0)},cwd:function(){return a},chdir:function(b){a=b}}}();a.define('/gif.coffee',function(d,m,l,k){function g(a,b){return{}.hasOwnProperty.call(a,b)}function j(d,b){for(var a=0,c=b.length;a<c;++a)if(a in b&&b[a]===d)return!0;return!1}function i(a,b){function d(){this.constructor=a}for(var c in b)g(b,c)&&(a[c]=b[c]);return d.prototype=b.prototype,a.prototype=new d,a.__super__=b.prototype,a}var h,c,f,b,e;f=a('events',d).EventEmitter,h=a('/browser.coffee',d),e=function(d){function a(d){var a,b;this.running=!1,this.options={},this.frames=[],this.freeWorkers=[],this.activeWorkers=[],this.setOptions(d);for(a in c)b=c[a],null!=this.options[a]?this.options[a]:this.options[a]=b}return i(a,d),c={workerScript:'gif.worker.js',workers:2,repeat:0,background:'#fff',quality:10,width:null,height:null,transparent:null},b={delay:500,copy:!1},a.prototype.setOption=function(a,b){return this.options[a]=b,null!=this._canvas&&(a==='width'||a==='height')?this._canvas[a]=b:void 0},a.prototype.setOptions=function(b){var a,c;return function(d){for(a in b){if(!g(b,a))continue;c=b[a],d.push(this.setOption(a,c))}return d}.call(this,[])},a.prototype.addFrame=function(a,d){var c,e;null==d&&(d={}),c={},c.transparent=this.options.transparent;for(e in b)c[e]=d[e]||b[e];if(null!=this.options.width||this.setOption('width',a.width),null!=this.options.height||this.setOption('height',a.height),'undefined'!==typeof ImageData&&null!=ImageData&&a instanceof ImageData)c.data=a.data;else if('undefined'!==typeof CanvasRenderingContext2D&&null!=CanvasRenderingContext2D&&a instanceof CanvasRenderingContext2D||'undefined'!==typeof WebGLRenderingContext&&null!=WebGLRenderingContext&&a instanceof WebGLRenderingContext)d.copy?c.data=this.getContextData(a):c.context=a;else if(null!=a.childNodes)d.copy?c.data=this.getImageData(a):c.image=a;else throw new Error('Invalid image');return this.frames.push(c)},a.prototype.render=function(){var d,a;if(this.running)throw new Error('Already running');if(!(null!=this.options.width&&null!=this.options.height))throw new Error('Width and height must be set prior to rendering');this.running=!0,this.nextFrame=0,this.finishedFrames=0,this.imageParts=function(c){for(var b=function(){var b;b=[];for(var a=0;0<=this.frames.length?a<this.frames.length:a>this.frames.length;0<=this.frames.length?++a:--a)b.push(a);return b}.apply(this,arguments),a=0,e=b.length;a<e;++a)d=b[a],c.push(null);return c}.call(this,[]),a=this.spawnWorkers();for(var c=function(){var c;c=[];for(var b=0;0<=a?b<a:b>a;0<=a?++b:--b)c.push(b);return c}.apply(this,arguments),b=0,e=c.length;b<e;++b)d=c[b],this.renderNextFrame();return this.emit('start'),this.emit('progress',0)},a.prototype.abort=function(){var a;while(!0){if(a=this.activeWorkers.shift(),!(null!=a))break;console.log('killing active worker'),a.terminate()}return this.running=!1,this.emit('abort')},a.prototype.spawnWorkers=function(){var a;return a=Math.min(this.options.workers,this.frames.length),function(){var c;c=[];for(var b=this.freeWorkers.length;this.freeWorkers.length<=a?b<a:b>a;this.freeWorkers.length<=a?++b:--b)c.push(b);return c}.apply(this,arguments).forEach(function(a){return function(c){var b;return console.log('spawning worker '+c),b=new Worker(a.options.workerScript),b.onmessage=function(a){return function(c){return a.activeWorkers.splice(a.activeWorkers.indexOf(b),1),a.freeWorkers.push(b),a.frameFinished(c.data)}}(a),a.freeWorkers.push(b)}}(this)),a},a.prototype.frameFinished=function(a){return console.log('frame '+a.index+' finished - '+this.activeWorkers.length+' active'),this.finishedFrames++,this.emit('progress',this.finishedFrames/this.frames.length),this.imageParts[a.index]=a,j(null,this.imageParts)?this.renderNextFrame():this.finishRendering()},a.prototype.finishRendering=function(){var e,a,k,m,b,d,h;b=0;for(var f=0,j=this.imageParts.length;f<j;++f)a=this.imageParts[f],b+=(a.data.length-1)*a.pageSize+a.cursor;b+=a.pageSize-a.cursor,console.log('rendering finished - filesize '+Math.round(b/1e3)+'kb'),e=new Uint8Array(b),d=0;for(var g=0,l=this.imageParts.length;g<l;++g){a=this.imageParts[g];for(var c=0,i=a.data.length;c<i;++c)h=a.data[c],k=c,e.set(h,d),k===a.data.length-1?d+=a.cursor:d+=a.pageSize}return m=new Blob([e],{type:'image/gif'}),this.emit('finished',m,e)},a.prototype.renderNextFrame=function(){var c,a,b;if(this.freeWorkers.length===0)throw new Error('No free workers');return this.nextFrame>=this.frames.length?void 0:(c=this.frames[this.nextFrame++],b=this.freeWorkers.shift(),a=this.getTask(c),console.log('starting frame '+(a.index+1)+' of '+this.frames.length),this.activeWorkers.push(b),b.postMessage(a))},a.prototype.getContextData=function(a){return a.getImageData(0,0,this.options.width,this.options.height).data},a.prototype.getImageData=function(b){var a;return null!=this._canvas||(this._canvas=document.createElement('canvas'),this._canvas.width=this.options.width,this._canvas.height=this.options.height),a=this._canvas.getContext('2d'),a.setFill=this.options.background,a.fillRect(0,0,this.options.width,this.options.height),a.drawImage(b,0,0),this.getContextData(a)},a.prototype.getTask=function(a){var c,b;if(c=this.frames.indexOf(a),b={index:c,last:c===this.frames.length-1,delay:a.delay,transparent:a.transparent,width:this.options.width,height:this.options.height,quality:this.options.quality,repeat:this.options.repeat,canTransfer:h.name==='chrome'},null!=a.data)b.data=a.data;else if(null!=a.context)b.data=this.getContextData(a.context);else if(null!=a.image)b.data=this.getImageData(a.image);else throw new Error('Invalid frame');return b},a}(f),d.exports=e}),a.define('/browser.coffee',function(f,g,h,i){var a,d,e,c,b;c=navigator.userAgent.toLowerCase(),e=navigator.platform.toLowerCase(),b=c.match(/(opera|ie|firefox|chrome|version)[\s\/:]([\w\d\.]+)?.*?(safari|version[\s\/:]([\w\d\.]+)|$)/)||[null,'unknown',0],d=b[1]==='ie'&&document.documentMode,a={name:b[1]==='version'?b[3]:b[1],version:d||parseFloat(b[1]==='opera'&&b[4]?b[4]:b[2]),platform:{name:c.match(/ip(?:ad|od|hone)/)?'ios':(c.match(/(?:webos|android)/)||e.match(/mac|win|linux/)||['other'])[0]}},a[a.name]=!0,a[a.name+parseInt(a.version,10)]=!0,a.platform[a.platform.name]=!0,f.exports=a}),a.define('events',function(f,e,g,h){b.EventEmitter||(b.EventEmitter=function(){});var a=e.EventEmitter=b.EventEmitter,c=typeof Array.isArray==='function'?Array.isArray:function(a){return Object.prototype.toString.call(a)==='[object Array]'},d=10;a.prototype.setMaxListeners=function(a){this._events||(this._events={}),this._events.maxListeners=a},a.prototype.emit=function(f){if(f==='error'&&(!(this._events&&this._events.error)||c(this._events.error)&&!this._events.error.length))throw arguments[1]instanceof Error?arguments[1]:new Error("Uncaught, unspecified 'error' event.");if(!this._events)return!1;var a=this._events[f];if(!a)return!1;if(!(typeof a=='function'))if(c(a)){var b=Array.prototype.slice.call(arguments,1),e=a.slice();for(var d=0,g=e.length;d<g;d++)e[d].apply(this,b);return!0}else return!1;switch(arguments.length){case 1:a.call(this);break;case 2:a.call(this,arguments[1]);break;case 3:a.call(this,arguments[1],arguments[2]);break;default:var b=Array.prototype.slice.call(arguments,1);a.apply(this,b)}return!0},a.prototype.addListener=function(a,b){if('function'!==typeof b)throw new Error('addListener only takes instances of Function');if(this._events||(this._events={}),this.emit('newListener',a,b),!this._events[a])this._events[a]=b;else if(c(this._events[a])){if(!this._events[a].warned){var e;this._events.maxListeners!==undefined?e=this._events.maxListeners:e=d,e&&e>0&&this._events[a].length>e&&(this._events[a].warned=!0,console.error('(node) warning: possible EventEmitter memory leak detected. %d listeners added. Use emitter.setMaxListeners() to increase limit.',this._events[a].length),console.trace())}this._events[a].push(b)}else this._events[a]=[this._events[a],b];return this},a.prototype.on=a.prototype.addListener,a.prototype.once=function(b,c){var a=this;return a.on(b,function d(){a.removeListener(b,d),c.apply(this,arguments)}),this},a.prototype.removeListener=function(a,d){if('function'!==typeof d)throw new Error('removeListener only takes instances of Function');if(!(this._events&&this._events[a]))return this;var b=this._events[a];if(c(b)){var e=b.indexOf(d);if(e<0)return this;b.splice(e,1),b.length==0&&delete this._events[a]}else this._events[a]===d&&delete this._events[a];return this},a.prototype.removeAllListeners=function(a){return a&&this._events&&this._events[a]&&(this._events[a]=null),this},a.prototype.listeners=function(a){return this._events||(this._events={}),this._events[a]||(this._events[a]=[]),c(this._events[a])||(this._events[a]=[this._events[a]]),this._events[a]}}),c.GIF=a('/gif.coffee')}.call(this,this))
//# sourceMappingURL=gif.js.map
// gif.js 0.1.6 - https://github.com/jnordberg/gif.js

},{}],13:[function(require,module,exports){
/**
 * Vash - JavaScript Template Parser, v0.7.12-1
 *
 * https://github.com/kirbysayshi/vash
 *
 * Copyright (c) 2013 Andrew Petersen
 * MIT License (LICENSE)
 */
void(0); // hack for https://github.com/mishoo/UglifyJS/issues/465
;(function(vash){

	// this pattern was inspired by LucidJS,
	// https://github.com/RobertWHurst/LucidJS/blob/master/lucid.js

	if(typeof define === 'function' && define['amd']){
		define(vash); // AMD
	} else if(typeof module === 'object' && module['exports']){
		module['exports'] = vash; // NODEJS
	} else {
		window['vash'] = vash; // BROWSER
	}

})(function(exports){

	var vash = exports; // neccessary for nodejs references/*jshint strict:false, asi:true, laxcomma:true, laxbreak:true, boss:true, curly:true, node:true, browser:true, devel:true */

// The basic tokens, defined as constants
var  AT = 'AT'
	,ASSIGN_OPERATOR = 'ASSIGN_OPERATOR'
	,AT_COLON = 'AT_COLON'
	,AT_STAR_CLOSE = 'AT_STAR_CLOSE'
	,AT_STAR_OPEN = 'AT_STAR_OPEN'
	,BACKSLASH = 'BACKSLASH'
	,BRACE_CLOSE = 'BRACE_CLOSE'
	,BRACE_OPEN = 'BRACE_OPEN'
	,CONTENT = 'CONTENT'
	,DOUBLE_QUOTE = 'DOUBLE_QUOTE'
	,EMAIL = 'EMAIL'
	,ESCAPED_QUOTE = 'ESCAPED_QUOTE'
	,FORWARD_SLASH = 'FORWARD_SLASH'
	,FUNCTION = 'FUNCTION'
	,HARD_PAREN_CLOSE = 'HARD_PAREN_CLOSE'
	,HARD_PAREN_OPEN = 'HARD_PAREN_OPEN'
	,HTML_TAG_CLOSE = 'HTML_TAG_CLOSE'
	,HTML_TAG_OPEN = 'HTML_TAG_OPEN'
	,HTML_TAG_VOID_CLOSE = 'HTML_TAG_VOID_CLOSE'
	,IDENTIFIER = 'IDENTIFIER'
	,KEYWORD = 'KEYWORD'
	,LOGICAL = 'LOGICAL'
	,NEWLINE = 'NEWLINE'
	,NUMERIC_CONTENT = 'NUMERIC_CONTENT'
	,OPERATOR = 'OPERATOR'
	,PAREN_CLOSE = 'PAREN_CLOSE'
	,PAREN_OPEN = 'PAREN_OPEN'
	,PERIOD = 'PERIOD'
	,SINGLE_QUOTE = 'SINGLE_QUOTE'
	,TEXT_TAG_CLOSE = 'TEXT_TAG_CLOSE'
	,TEXT_TAG_OPEN = 'TEXT_TAG_OPEN'
	,WHITESPACE = 'WHITESPACE';

var PAIRS = {};

// defined through indexing to help minification
PAIRS[AT_STAR_OPEN] = AT_STAR_CLOSE;
PAIRS[BRACE_OPEN] = BRACE_CLOSE;
PAIRS[DOUBLE_QUOTE] = DOUBLE_QUOTE;
PAIRS[HARD_PAREN_OPEN] = HARD_PAREN_CLOSE;
PAIRS[PAREN_OPEN] = PAREN_CLOSE;
PAIRS[SINGLE_QUOTE] = SINGLE_QUOTE;
PAIRS[AT_COLON] = NEWLINE;
PAIRS[FORWARD_SLASH] = FORWARD_SLASH; // regex



// The order of these is important, as it is the order in which
// they are run against the input string.
// They are separated out here to allow for better minification
// with the least amount of effort from me. :)

// NOTE: this is an array, not an object literal! The () around
// the regexps are for the sake of the syntax highlighter in my
// editor... sublimetext2

var TESTS = [

	// A real email address is considerably more complex, and unfortunately
	// this complexity makes it impossible to differentiate between an address
	// and an AT expression.
	//
	// Instead, this regex assumes the only valid characters for the user portion
	// of the address are alphanumeric, period, and %. This means that a complex email like
	// who-something@example.com will be interpreted as an email, but incompletely. `who-`
	// will be content, while `something@example.com` will be the email address.
	//
	// However, this is "Good Enough"© :).
	EMAIL, (/^([a-zA-Z0-9.%]+@[a-zA-Z0-9.\-]+\.(?:ca|co\.uk|com|edu|net|org))\b/)


	,AT_STAR_OPEN, (/^(@\*)/)
	,AT_STAR_CLOSE, (/^(\*@)/)


	,AT_COLON, (/^(@\:)/)
	,AT, (/^(@)/)


	,PAREN_OPEN, (/^(\()/)
	,PAREN_CLOSE, (/^(\))/)


	,HARD_PAREN_OPEN, (/^(\[)/)
	,HARD_PAREN_CLOSE, (/^(\])/)


	,BRACE_OPEN, (/^(\{)/)
	,BRACE_CLOSE, (/^(\})/)


	,TEXT_TAG_OPEN, (/^(<text>)/)
	,TEXT_TAG_CLOSE, (/^(<\/text>)/)


	,HTML_TAG_OPEN, function(){

		// Some context:
		// These only need to match something that is _possibly_ a tag,
		// self closing tag, or email address. They do not need to be able to
		// fully parse a tag into separate parts. They can be thought of as a
		// huge look ahead to determine if a large swath of text is an tag,
		// even if it contains other components (like expressions or else).

		var  reHtml = /^(<[a-zA-Z@]+?[^>]*?["a-zA-Z]*>)/
			,reEmail = /([a-zA-Z0-9.%]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,4})\b/

		var tok = this.scan( reHtml, HTML_TAG_OPEN );

		if( tok ){
			this.spewIf( tok, reEmail );
			this.spewIf( tok, /(@)/ );
			this.spewIf( tok, /(\/\s*>)/ );
		}

		return tok;
	}
	,HTML_TAG_CLOSE, (/^(<\/[^>@\b]+?>)/)
	,HTML_TAG_VOID_CLOSE, (/^(\/\s*>)/)


	,PERIOD, (/^(\.)/)
	,NEWLINE, function(){
		var token = this.scan(/^(\n)/, NEWLINE);
		if(token){
			this.lineno++;
			this.charno = 0;
		}
		return token;
	}
	,WHITESPACE, (/^(\s)/)
	,FUNCTION, (/^(function)(?![\d\w])/)
	,KEYWORD, (/^(case|catch|do|else|finally|for|function|goto|if|instanceof|return|switch|try|typeof|var|while|with)(?![\d\w])/)
	,IDENTIFIER, (/^([_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*)/)

	,FORWARD_SLASH, (/^(\/)/)

	,OPERATOR, (/^(===|!==|==|!==|>>>|<<|>>|>=|<=|>|<|\+|-|\/|\*|\^|%|\:|\?)/)
	,ASSIGN_OPERATOR, (/^(\|=|\^=|&=|>>>=|>>=|<<=|-=|\+=|%=|\/=|\*=|=)/)
	,LOGICAL, (/^(&&|\|\||&|\||\^)/)


	,ESCAPED_QUOTE, (/^(\\+['"])/)
	,BACKSLASH, (/^(\\)/)
	,DOUBLE_QUOTE, (/^(\")/)
	,SINGLE_QUOTE, (/^(\')/)


	,NUMERIC_CONTENT, (/^([0-9]+)/)
	,CONTENT, (/^([^\s})@.]+?)/)

];

// This pattern and basic lexer code were originally from the
// Jade lexer, but have been modified:
// https://github.com/visionmedia/jade/blob/master/lib/lexer.js

function VLexer(str){
	this.input = this.originalInput = str
		.replace(/^\uFEFF/, '') // Kill BOM
		.replace(/\r\n|\r/g, '\n');
	this.lineno = 1;
	this.charno = 0;
}

VLexer.prototype = {

	scan: function(regexp, type){
		var captures, token;
		if (captures = regexp.exec(this.input)) {
			this.input = this.input.substr((captures[1].length));

			token = {
				type: type
				,line: this.lineno
				,chr: this.charno
				,val: captures[1] || ''
				,toString: function(){
					return '[' + this.type
						+ ' (' + this.line + ',' + this.chr + '): '
						+ this.val + ']';
				}
			};

			this.charno += captures[0].length;
			return token;
		}
	}

	,spewIf: function( tok, re ){
		var result, index, spew

		if( tok ){
			result = re.exec( tok.val );

			if( result ){
				index = tok.val.indexOf( result[1] );
				spew = tok.val.substring( index );
				this.input = spew + this.input;
				this.charno -= spew.length;
				tok.val = tok.val.substring( 0, index );
			}
		}

		return tok;
	}

	,advance: function() {

		var i, name, test, result;

		for(i = 0; i < TESTS.length; i += 2){
			test = TESTS[i+1];
			test.displayName = TESTS[i];

			if(typeof test === 'function'){
				// assume complex callback
				result = test.call(this);
			}

			if(typeof test.exec === 'function'){
				// assume regex
				result = this.scan(test, TESTS[i]);
			}

			if( result ){
				return result;
			}
		}
	}
}
/*jshint strict:false, asi:true, laxcomma:true, laxbreak:true, boss:true, curly:true, node:true, browser:true, devel:true */

var vQuery = function(node){
	return new vQuery.fn.init(node);
}

vQuery.prototype.init = function(astNode){

	// handle mode string
	if(typeof astNode === 'string'){
		this.mode = astNode;
	}

	this.maxCheck();
}

vQuery.fn = vQuery.prototype.init.prototype = vQuery.prototype;

vQuery.fn.vquery = 'yep';
vQuery.fn.constructor = vQuery;
vQuery.fn.length = 0;
vQuery.fn.parent = null;
vQuery.fn.mode = null;
vQuery.fn.tagName = null;

vQuery.fn.beget = function(mode, tagName){
	var child = vQuery(mode);
	child.parent = this;
	this.push( child );

	if(tagName) { child.tagName = tagName; }

	this.maxCheck();

	return child;
}

vQuery.fn.closest = function(mode, tagName){
	var p = this;

	while(p){

		if( p.tagName !== tagName && p.parent ){
			p = p.parent;
		} else {
			break;
		}
	}

	return p;
}

vQuery.fn.pushFlatten = function(node){
	var n = node, i, children;

	while( n.length === 1 && n[0].vquery ){
		n = n[0];
	}

	if(n.mode !== PRG){
		this.push(n);
	} else {

		for(i = 0; i < n.length; i++){
			this.push( n[i] );
		}
	}

	this.maxCheck();

	return this;
}

vQuery.fn.push = function(nodes){

	if(vQuery.isArray(nodes)){
		if(nodes.vquery){
			nodes.forEach(function(node){ node.parent = this; }, this);
		}
		
		Array.prototype.push.apply(this, nodes);
	} else {
		if(nodes.vquery){
			nodes.parent = this;
		}
		
		Array.prototype.push.call(this, nodes);
	}

	this.maxCheck();

	return this.length;
}

vQuery.fn.root = function(){
	var p = this;

	while(p && p.parent && (p = p.parent)){}

	return p;
}

vQuery.fn.toTreeString = function(){
	var  buffer = []
		,indent = 1;

	function visitNode(node){
		var  children
			,child;

		buffer.push( Array(indent).join(' |') + ' +' + node.mode + ' ' + ( node.tagName || '' ) );

		indent += 1;
		children = node.slice();
		while( (child = children.shift()) ){

			if(child.vquery === vQuery.fn.vquery){
				// recurse
				visitNode(child);
			} else {
				buffer.push( Array(indent).join(' |') + ' '
					+ (child
						?  child.toString().replace(/(\r|\n)/g, '')
						: '[empty]')
				);
			}

		}

		indent -= 1;
		buffer.push( Array(indent).join(' |') + ' -' + node.mode + ' ' + ( node.tagName || '' ) );
	}

	visitNode(this);

	return buffer.join('\n');
}

vQuery.fn.maxCheck = function(last){
	if( this.length >= vQuery.maxSize ){
		var e = new Error();
		e.message = 'Maximum number of elements exceeded.\n'
			+ 'This is typically caused by an unmatched character or tag. Parse tree follows:\n'
			+ this.toTreeString();
		e.name = 'vQueryDepthException';
		throw e;
	}
}

vQuery.maxSize = 100000;

// takes a full nested set of vqueries (e.g. an AST), and flattens them 
// into a plain array. Useful for performing queries, or manipulation,
// without having to handle a lot of parsing state.
vQuery.fn.flatten = function(){
	var reduced;
	return this.reduce(function flatten(all, tok, i, orig){

		if( tok.vquery ){ 
			all.push( { type: 'META', val: 'START' + tok.mode, tagName: tok.tagName } );
			reduced = tok.reduce(flatten, all);
			reduced.push( { type: 'META', val: 'END' + tok.mode, tagName: tok.tagName } );
			return reduced;
		}
		
		// grab the mode from the original vquery container 
		tok.mode = orig.mode;
		all.push( tok );

		return all;
	}, []);
}

// take a flat array created via vQuery.fn.flatten, and recreate the 
// original AST. 
vQuery.reconstitute = function(arr){
	return arr.reduce(function recon(ast, tok, i, orig){

		if( tok.type === 'META' ) {
			ast = ast.parent;
		} else {

			if( tok.mode !== ast.mode ) {
				ast = ast.beget(tok.mode, tok.tagName);
			}

			ast.push( tok );
		}

		return ast;
	}, vQuery(PRG))
}

vQuery.isArray = function(obj){
	return Object.prototype.toString.call(obj) == '[object Array]';
}

vQuery.extend = function(obj){
	var next, i, p;

	for(i = 1; i < arguments.length; i++){
		next = arguments[i];

		for(p in next){
			obj[p] = next[p];
		}
	}

	return obj;
}

vQuery.takeMethodsFromArray = function(){
	var methods = [
		'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift',
		'concat', 'join', 'slice', 'indexOf', 'lastIndexOf',
		'filter', 'forEach', 'every', 'map', 'some', 'reduce', 'reduceRight'
	]

		,arr = []
		,m;

	for (var i = 0; i < methods.length; i++){
		m = methods[i];
		if( typeof arr[m] === 'function' ){
			if( !vQuery.fn[m] ){
				(function(methodName){
					vQuery.fn[methodName] = function(){
						return arr[methodName].apply(this, Array.prototype.slice.call(arguments, 0));
					}
				})(m);
			}
		} else {
			throw new Error('Vash requires ES5 array iteration methods, missing: ' + m);
		}
	}

}

vQuery.takeMethodsFromArray(); // run on page load
/*jshint strict:false, asi:true, laxcomma:true, laxbreak:true, boss:true, curly:true, node:true, browser:true, devel:true */

function VParser(tokens, options){

	this.options = options || {};
	this.tokens = tokens;
	this.ast = vQuery(PRG);
	this.prevTokens = [];

	this.inCommentLine = false;
}

var PRG = "PROGRAM", MKP = "MARKUP", BLK = "BLOCK", EXP = "EXPRESSION" ;

VParser.prototype = {

	parse: function(){
		var curr, i, len, block;

		while( this.prevTokens.push( curr ), (curr = this.tokens.pop()) ){

			if(this.options.debugParser){
				console.log(this.ast && this.ast.mode, curr.type, curr.toString(), curr.val);
			}

			if(this.ast.mode === PRG || this.ast.mode === null){

				this.ast = this.ast.beget( this.options.initialMode || MKP );

				if(this.options.initialMode === EXP){
					this.ast = this.ast.beget( EXP ); // EXP needs to know it's within to continue
				}
			}

			if(this.ast.mode === MKP){
				this.handleMKP(curr);
				continue;
			}

			if(this.ast.mode === BLK){
				this.handleBLK(curr);
				continue;
			}

			if(this.ast.mode === EXP){
				this.handleEXP(curr);
				continue;
			}
		}

		this.ast = this.ast.root();

		if(this.options.debugParser && !this.options.initialMode){
			// this should really only output on the true root

			console.log(this.ast.toString());
			console.log(this.ast.toTreeString());
		}

		return this.ast;
	}

	,exceptionFactory: function(e, type, tok){

		// second param is either a token or string?

		if(type == 'UNMATCHED'){

			e.name = "UnmatchedCharacterError";

			this.ast = this.ast.root();

			if(tok){
				e.message = 'Unmatched ' + tok.type
					//+ ' near: "' + context + '"'
					+ ' at line ' + tok.line
					+ ', character ' + tok.chr
					+ '. Value: ' + tok.val
					+ '\n ' + this.ast.toTreeString();
				e.lineNumber = tok.line;
			}
		}

		return e;
	}

	,advanceUntilNot: function(untilNot){
		var curr, next, tks = [];

		while( next = this.tokens[ this.tokens.length - 1 ] ){
			if(next.type === untilNot){
				curr = this.tokens.pop();
				tks.push(curr);
			} else {
				break;
			}
		}

		return tks;
	}

	,advanceUntilMatched: function(curr, start, end, startEscape, endEscape){
		var  next = curr
			,prev = null
			,nstart = 0
			,nend = 0
			,tks = [];

		// this is fairly convoluted because the start and end for single/double
		// quotes is the same, and can also be escaped

		while(next){

			if( next.type === start ){

				if( (prev && prev.type !== startEscape && start !== end) || !prev ){
					nstart++;
				} else if( start === end && prev.type !== startEscape ) {
					nend++;
				}

			} else if( next.type === end ){
				nend++;
				if(prev && prev.type === endEscape){ nend--; }
			}

			tks.push(next);

			if(nstart === nend) { break; }
			prev = next;
			next = this.tokens.pop();
			if(!next) { throw this.exceptionFactory(new Error(), 'UNMATCHED', curr); }
		}

		return tks.reverse();
	}

	,subParse: function(curr, modeToOpen, includeDelimsInSub){
		var  subTokens
			,closer
			,miniParse
			,parseOpts = vQuery.extend({}, this.options);

		parseOpts.initialMode = modeToOpen;

		subTokens = this.advanceUntilMatched(
			curr
			,curr.type
			,PAIRS[ curr.type ]
			,null
			,AT );

		subTokens.pop();

		closer = subTokens.shift();

		if( !includeDelimsInSub ){
			this.ast.push(curr);
		}

		miniParse = new VParser( subTokens, parseOpts );
		miniParse.parse();

		if( includeDelimsInSub ){
			// attach delimiters to [0] (first child), because ast is PROGRAM
			miniParse.ast[0].unshift( curr );
			miniParse.ast[0].push( closer );
		}

		this.ast.pushFlatten(miniParse.ast);

		if( !includeDelimsInSub ){
			this.ast.push(closer);
		}
	}

	,handleMKP: function(curr){
		var  next = this.tokens[ this.tokens.length - 1 ]
			,ahead = this.tokens[ this.tokens.length - 2 ]
			,tagName = null
			,opener;

		switch(curr.type){

			case AT_STAR_OPEN:
				this.advanceUntilMatched(curr, AT_STAR_OPEN, AT_STAR_CLOSE, AT, AT);
				break;

			case AT:
				if(next) {

					if(this.options.saveAT) this.ast.push( curr );

					switch(next.type){

						case PAREN_OPEN:
						case IDENTIFIER:

							if(this.ast.length === 0) {
								this.ast = this.ast.parent;
								this.ast.pop(); // remove empty MKP block
							}

							this.ast = this.ast.beget( EXP );
							break;

						case KEYWORD:
						case FUNCTION:
						case BRACE_OPEN:

							if(this.ast.length === 0) {
								this.ast = this.ast.parent;
								this.ast.pop(); // remove empty MKP block
							}

							this.ast = this.ast.beget( BLK );
							break;

						case AT:
						case AT_COLON:

							// we want to keep the token, but remove its
							// "special" meaning because during compilation
							// AT and AT_COLON are discarded
							next.type = 'CONTENT';
							this.ast.push( this.tokens.pop() );
							break;

						default:
							this.ast.push( this.tokens.pop() );
							break;
					}

				}
				break;

			case TEXT_TAG_OPEN:
			case HTML_TAG_OPEN:
				tagName = curr.val.match(/^<([^\/ >]+)/i);

				if(tagName === null && next && next.type === AT && ahead){
					tagName = ahead.val.match(/(.*)/); // HACK for <@exp>
				}

				if(this.ast.tagName){
					// current markup is already waiting for a close tag, make new child
					this.ast = this.ast.beget(MKP, tagName[1]);
				} else {
					this.ast.tagName = tagName[1];
				}

				if(
					HTML_TAG_OPEN === curr.type
					|| this.options.saveTextTag
				){
					this.ast.push(curr);
				}

				break;

			case TEXT_TAG_CLOSE:
			case HTML_TAG_CLOSE:
				tagName = curr.val.match(/^<\/([^>]+)/i);

				if(tagName === null && next && next.type === AT && ahead){
					tagName = ahead.val.match(/(.*)/); // HACK for </@exp>
				}

				opener = this.ast.closest( MKP, tagName[1] );

				if(opener === null || opener.tagName !== tagName[1]){
					// couldn't find opening tag
					// could mean this closer is within a child parser
					//throw this.exceptionFactory(new Error, 'UNMATCHED', curr);
				} else {
					this.ast = opener;
				}

				if(HTML_TAG_CLOSE === curr.type || this.options.saveTextTag) {
					this.ast.push( curr );
				}

				// close this ast if parent is BLK. if another tag follows, BLK will
				// flip over to MKP
				if( this.ast.parent && this.ast.parent.mode === BLK ){
					this.ast = this.ast.parent;
				}

				break;

			case HTML_TAG_VOID_CLOSE:
				this.ast.push(curr);
				this.ast = this.ast.parent;
				break;

			case BACKSLASH:
				curr.val += '\\';
				this.ast.push(curr);
				break;

			default:
				this.ast.push(curr);
				break;
		}

	}

	,handleBLK: function(curr){

		var  next = this.tokens[ this.tokens.length - 1 ]
			,submode
			,opener
			,closer
			,subTokens
			,parseOpts
			,miniParse
			,i;

		switch(curr.type){

			case AT:
				if(next.type !== AT && !this.inCommentLine){
					this.tokens.push(curr); // defer
					this.ast = this.ast.beget(MKP);
				} else {
					// we want to keep the token, but remove its
					// "special" meaning because during compilation
					// AT and AT_COLON are discarded
					next.type = CONTENT;
					this.ast.push(next);
					this.tokens.pop(); // skip following AT
				}
				break;

			case AT_STAR_OPEN:
				this.advanceUntilMatched(curr, AT_STAR_OPEN, AT_STAR_CLOSE, AT, AT);
				break;

			case AT_COLON:
				this.subParse(curr, MKP, true);
				break;

			case TEXT_TAG_OPEN:
			case TEXT_TAG_CLOSE:
			case HTML_TAG_OPEN:
			case HTML_TAG_CLOSE:
				this.ast = this.ast.beget(MKP);
				this.tokens.push(curr); // defer
				break;

			case FORWARD_SLASH:
			case SINGLE_QUOTE:
			case DOUBLE_QUOTE:
				if(
					curr.type === FORWARD_SLASH
					&& next
					&& next.type === FORWARD_SLASH
				){
					this.inCommentLine = true;
				}

				if(!this.inCommentLine) {
					// assume regex or quoted string
					subTokens = this.advanceUntilMatched(
						 curr
						,curr.type
						,PAIRS[ curr.type ]
						,BACKSLASH
						,BACKSLASH ).map(function(tok){
							// mark AT within a regex/quoted string as literal
							if(tok.type === AT) tok.type = CONTENT;
							return tok;
						});
					this.ast.pushFlatten(subTokens.reverse());
				} else {
					this.ast.push(curr);
				}

				break;

			case NEWLINE:
				if(this.inCommentLine){
					this.inCommentLine = false;
				}
				this.ast.push(curr);
				break;

			case BRACE_OPEN:
			case PAREN_OPEN:
				submode = this.options.favorText && curr.type === BRACE_OPEN
					? MKP
					: BLK;

				this.subParse( curr, submode );

				subTokens = this.advanceUntilNot(WHITESPACE);
				next = this.tokens[ this.tokens.length - 1 ];

				if(
					next
					&& next.type !== KEYWORD
					&& next.type !== FUNCTION
					&& next.type !== BRACE_OPEN
					&& curr.type !== PAREN_OPEN
				){
					// defer whitespace
					this.tokens.push.apply(this.tokens, subTokens.reverse());
					this.ast = this.ast.parent;
				} else {
					this.ast.push(subTokens);
				}

				break;

			default:
				this.ast.push(curr);
				break;
		}

	}

	,handleEXP: function(curr){

		var ahead = null
			,opener
			,closer
			,parseOpts
			,miniParse
			,subTokens
			,prev
			,i;

		switch(curr.type){

			case KEYWORD:
			case FUNCTION:
				this.ast = this.ast.beget(BLK);
				this.tokens.push(curr); // defer
				break;

			case WHITESPACE:
			case LOGICAL:
			case ASSIGN_OPERATOR:
			case OPERATOR:
			case NUMERIC_CONTENT:
				if(this.ast.parent && this.ast.parent.mode === EXP){

					this.ast.push(curr);
				} else {

					// if not contained within a parent EXP, must be end of EXP
					this.ast = this.ast.parent;
					this.tokens.push(curr); // defer
				}

				break;

			case IDENTIFIER:
				this.ast.push(curr);
				break;

			case SINGLE_QUOTE:
			case DOUBLE_QUOTE:

				if(this.ast.parent && this.ast.parent.mode === EXP){
					subTokens = this.advanceUntilMatched(
						curr
						,curr.type
						,PAIRS[ curr.type ]
						,BACKSLASH
						,BACKSLASH );
					this.ast.pushFlatten(subTokens.reverse());

				} else {
					// probably end of expression
					this.ast = this.ast.parent;
					this.tokens.push(curr); // defer
				}

				break;

			case HARD_PAREN_OPEN:
			case PAREN_OPEN:

				prev = this.prevTokens[ this.prevTokens.length - 1 ];
				ahead = this.tokens[ this.tokens.length - 1 ];

				if( curr.type === HARD_PAREN_OPEN && ahead.type === HARD_PAREN_CLOSE ){
					// likely just [], which is not likely valid outside of EXP
					this.tokens.push(curr); // defer
					this.ast = this.ast.parent; //this.ast.beget(MKP);
					break;
				}

				this.subParse(curr, EXP);
				ahead = this.tokens[ this.tokens.length - 1 ];

				if( (prev && prev.type === AT) || (ahead && ahead.type === IDENTIFIER) ){
					// explicit expression is automatically ended
					this.ast = this.ast.parent;
				}

				break;

			case BRACE_OPEN:
				this.tokens.push(curr); // defer
				this.ast = this.ast.beget(BLK);
				break;

			case PERIOD:
				ahead = this.tokens[ this.tokens.length - 1 ];
				if(
					ahead &&
					(  ahead.type === IDENTIFIER
					|| ahead.type === KEYWORD
					|| ahead.type === FUNCTION
					|| ahead.type === PERIOD
					// if it's "expressions all the way down", then there is no way
					// to exit EXP mode without running out of tokens, i.e. we're
					// within a sub parser
					|| this.ast.parent && this.ast.parent.mode === EXP )
				) {
					this.ast.push(curr);
				} else {
					this.ast = this.ast.parent;
					this.tokens.push(curr); // defer
				}
				break;

			default:

				if( this.ast.parent && this.ast.parent.mode !== EXP ){
					// assume end of expression
					this.ast = this.ast.parent;
					this.tokens.push(curr); // defer
				} else {
					this.ast.push(curr);
				}

				break;
		}
	}
}
/*jshint strict:false, asi:true, laxcomma:true, laxbreak:true, boss:true, curly:true, node:true, browser:true, devel:true */

function VCompiler(ast, originalMarkup, options){
	this.ast = ast;
	this.originalMarkup = originalMarkup || '';
	this.options = options || {};

	this.reQuote = /(['"])/gi
	this.reEscapedQuote = /\\+(["'])/gi
	this.reLineBreak = /\r?\n/gi
	this.reHelpersName = /HELPERSNAME/g
	this.reModelName = /MODELNAME/g
	this.reOriginalMarkup = /ORIGINALMARKUP/g

	this.buffer = [];
}

var VCP = VCompiler.prototype;

VCP.insertDebugVars = function(tok){

	if(this.options.debug){
		this.buffer.push(
			this.options.helpersName + '.vl = ' + tok.line + ', '
			,this.options.helpersName + '.vc = ' + tok.chr + '; \n'
		);
	}
}

VCP.visitMarkupTok = function(tok, parentNode, index){

	this.insertDebugVars(tok);
	this.buffer.push(
		"MKP(" + tok.val
			.replace(this.reEscapedQuote, '\\\\$1')
			.replace(this.reQuote, '\\$1')
			.replace(this.reLineBreak, '\\n')
		+ ")MKP" );
}

VCP.visitBlockTok = function(tok, parentNode, index){

	this.buffer.push( tok.val );
}

VCP.visitExpressionTok = function(tok, parentNode, index, isHomogenous){

	var  start = ''
		,end = ''
		,parentParentIsNotEXP = parentNode.parent && parentNode.parent.mode !== EXP;

	if(this.options.htmlEscape !== false){

		if( parentParentIsNotEXP && index === 0 && isHomogenous ){
			start += this.options.helpersName + '.escape(';
		}

		if( parentParentIsNotEXP && index === parentNode.length - 1 && isHomogenous){
			end += ").toHtmlString()";
		}
	}

	if(parentParentIsNotEXP && (index === 0 ) ){
		this.insertDebugVars(tok);
		start = "__vbuffer.push(" + start;
	}

	if( parentParentIsNotEXP && index === parentNode.length - 1 ){
		end += "); \n";
	}

	this.buffer.push( start + tok.val + end );

	if(parentParentIsNotEXP && index === parentNode.length - 1){
		this.insertDebugVars(tok);
	}
}

VCP.visitNode = function(node){

	var n, children = node.slice(0), nonExp, i, child;

	if(node.mode === EXP && (node.parent && node.parent.mode !== EXP)){
		// see if this node's children are all EXP
		nonExp = node.filter(VCompiler.findNonExp).length;
	}

	for(i = 0; i < children.length; i++){
		child = children[i];

		// if saveAT is true, or if AT_COLON is used, these should not be compiled
		if( child.type && child.type === AT || child.type === AT_COLON ) continue;

		if(child.vquery){

			this.visitNode(child);

		} else if(node.mode === MKP){

			this.visitMarkupTok(child, node, i);

		} else if(node.mode === BLK){

			this.visitBlockTok(child, node, i);

		} else if(node.mode === EXP){

			this.visitExpressionTok(child, node, i, (nonExp > 0 ? false : true));

		}
	}

}

VCP.escapeForDebug = function( str ){
	return str
		.replace(this.reLineBreak, '!LB!')
		.replace(this.reQuote, '\\$1')
		.replace(this.reEscapedQuote, '\\$1')
}

VCP.replaceDevTokens = function( str ){
	return str
		.replace( this.reHelpersName, this.options.helpersName )
		.replace( this.reModelName, this.options.modelName );
}

VCP.addHead = function(body){

	var options = this.options;

	var head = ''
		+ (options.debug ? 'try { \n' : '')
		+ 'var __vbuffer = HELPERSNAME.buffer; \n'
		+ 'HELPERSNAME.options = __vopts; \n'
		+ 'MODELNAME = MODELNAME || {}; \n'
		+ (options.useWith ? 'with( MODELNAME ){ \n' : '');

	head = this.replaceDevTokens( head );
	return head + body;
}

VCP.addHelperHead = function(body){

	var options = this.options;

	var head = ''
		+ (options.debug ? 'try { \n' : '')
		+ 'var __vbuffer = this.buffer; \n'
		+ 'var MODELNAME = this.model; \n'
		+ 'var HELPERSNAME = this; \n';

	head = this.replaceDevTokens( head );
	return head + body;
}

VCP.addFoot = function(body){

	var options = this.options;

	var foot = ''
		+ (options.simple
			? 'return HELPERSNAME.buffer.join(""); \n'
			: '(__vopts && __vopts.onRenderEnd && __vopts.onRenderEnd(null, HELPERSNAME)); \n'
				+ 'return (__vopts && __vopts.asContext) \n'
				+ '  ? HELPERSNAME \n'
				+ '  : HELPERSNAME.toString(); \n' )
		+ (options.useWith ? '} \n' : '')
		+ (options.debug ? '} catch( e ){ \n'
			+ '  HELPERSNAME.reportError( e, HELPERSNAME.vl, HELPERSNAME.vc, "ORIGINALMARKUP" ); \n'
			+ '} \n' : '');

	foot = this.replaceDevTokens( foot )
		.replace( this.reOriginalMarkup, this.escapeForDebug( this.originalMarkup ) );

	return body + foot;
}

VCP.addHelperFoot = function(body){

	var options = this.options;

	var foot = ''
		+ (options.debug ? '} catch( e ){ \n'
			+ '  HELPERSNAME.reportError( e, HELPERSNAME.vl, HELPERSNAME.vc, "ORIGINALMARKUP" ); \n'
			+ '} \n' : '');

	foot = this.replaceDevTokens( foot )
		.replace( this.reOriginalMarkup, this.escapeForDebug( this.originalMarkup ) );

	return body + foot;
}

VCP.generate = function(){
	var options = this.options;

	// clear whatever's in the current buffer
	this.buffer.length = 0;

	this.visitNode(this.ast);

	// coalesce markup
	var joined = this.buffer
		.join("")
		.split(")MKPMKP(").join('')
		.split("MKP(").join( "__vbuffer.push('")
		.split(")MKP").join("'); \n");

	if(!options.asHelper){
		joined = this.addHead( joined );
		joined = this.addFoot( joined );
	} else {
		joined = this.addHelperHead( joined );
		joined = this.addHelperFoot( joined );
	}

	if(options.debugCompiler){
		console.log(joined);
		console.log(options);
	}

	this.cmpFunc = vash.link( joined, options );
	return this.cmpFunc;
}

VCompiler.noop = function(){}

VCompiler.findNonExp = function(node){

	if(node.vquery && node.mode === EXP){
		return node.filter(VCompiler.findNonExp).length > 0;
	}

	if(node.vquery && node.mode !== EXP){
		return true;
	} else {
		return false;
	}
}
exports["config"] = {
	 "useWith": false
	,"modelName": "model"
	,"helpersName": "html"
	,"htmlEscape": true
	,"debug": true
	,"debugParser": false
	,"debugCompiler": false
	,"simple": false

	,"favorText": false

	,"externs": [ 'window', 'document' ]

	,"saveTextTag": false
	,"saveAT": false
};

exports["compile"] = function compile(markup, options){

	if(markup === '' || typeof markup !== 'string') {
		throw new Error('Empty or non-string cannot be compiled');
	}

	var  l
		,tok
		,tokens = []
		,p
		,c
		,cmp
		,i;

	options = vQuery.extend( {}, exports.config, options || {} );

	l = new VLexer(markup);
	while(tok = l.advance()) { tokens.push(tok); }
	tokens.reverse(); // parser needs in reverse order for faster popping vs shift

	p = new VParser(tokens, options);
	p.parse();

	c = new VCompiler(p.ast, markup, options);

	cmp = c.generate();
	return cmp;
};

///////////////////////////////////////////////////////////////////////////
// HELPER AND BATCH COMPILATION

var  slice = Array.prototype.slice

	,reHelperFuncHead = /vash\.helpers\.([^= ]+?)\s*=\s*function([^(]*?)\(([^)]*?)\)\s*{/
	,reHelperFuncTail = /\}$/

	,reBatchSeparator = /^\/\/\s*@\s*batch\s*=\s*(.*?)$/

// Given a separator regex and a function to transform the regex result
// into a name, take a string, split it, and group the rejoined strings
// into an object.
// This is useful for taking a string, such as
//
// 		// tpl1
// 		what what
// 		and more
//
// 		// tpl2
// 		what what again
//
// and returning:
//
//		{
//			tpl1: 'what what\nand more\n',
//			tpl2: 'what what again'
//		}
var splitByNamedTpl = function(reSeparator, markup, resultHandler, keepSeparator){

	var  lines = markup.split(/[\n\r]/g)
		,tpls = {}
		,paths = []
		,currentPath = ''

	lines.forEach(function(line, i){

		var  pathResult = reSeparator.exec(line)
			,handlerResult = pathResult ? resultHandler.apply(pathResult, pathResult) : null

		if(handlerResult){
			currentPath = handlerResult;
			tpls[currentPath] = [];
		}

		if((!handlerResult || keepSeparator) && line){
			tpls[currentPath].push(line);
		}
	});

	Object.keys(tpls).forEach(function(key){
		tpls[key] = tpls[key].join('\n');
	})

	return tpls;
}

// The logic for compiling a giant batch of templates or several
// helpers is nearly exactly the same. The only difference is the
// actual compilation method called, and the regular expression that
// determines how the giant string is split into named, uncompiled
// template strings.
var compileBatchOrHelper = function(type, str, options){

	var separator = type === 'helper'
		? reHelperFuncHead
		: reBatchSeparator;

	var tpls = splitByNamedTpl(separator, str, function(ma, name){
		return name.replace(/^\s+|\s+$/, '');
	}, type === 'helper' ? true : false);

	if(tpls){
		Object.keys(tpls).forEach(function(path){
			tpls[path] = type === 'helper'
				? compileSingleHelper(tpls[path], options)
				: vash.compile('@{' + tpls[path] + '}', options);
		});

		tpls.toClientString = function(){
			return Object.keys(tpls).reduce(function(prev, curr){
				if(curr === 'toClientString'){
					return prev;
				}
				return prev + tpls[curr].toClientString() + '\n';
			}, '')
		}
	}

	return tpls;
}

var compileSingleHelper = function(str, options){

	options = options || {};

		// replace leading/trailing spaces, and parse the function head
	var  def = str.replace(/^[\s\n\r]+|[\s\n\r]+$/, '').match(reHelperFuncHead)
		// split the function arguments, kill all whitespace
		,args = def[3].split(',').map(function(arg){ return arg.replace(' ', '') })
		,name = def[1]
		,body = str
			.replace( reHelperFuncHead, '' )
			.replace( reHelperFuncTail, '' )

	// Wrap body in @{} to simulate it actually being inside a function
	// definition, since we manually stripped it. Without this, statements
	// such as `this.what = "what";` that are at the beginning of the body
	// will be interpreted as markup.
	body = '@{' + body + '}';

	// `args` and `asHelper` inform `vash.compile/link` that this is a helper
	options.args = args;
	options.asHelper = name;
	return vash.compile(body, options);
}

///////////////////////////////////////////////////////////////////////////
// VASH.COMPILEHELPER
//
// Allow multiple helpers to be compiled as templates, for helpers that
// do a lot of markup output.
//
// Takes a template such as:
//
// 		vash.helpers.p = function(text){
// 			<p>@text</p>
// 		}
//
// And compiles it. The template is then added to `vash.helpers`.
//
// Returns the compiled templates as named properties of an object.
//
// This is string manipulation at its... something. It grabs the arguments
// and function name using a regex, not actual parsing. Definitely error-
// prone, but good enough. This is meant to facilitate helpers with complex
// markup, but if something more advanced needs to happen, a plain helper
// can be defined and markup added using the manual Buffer API.
exports['compileHelper'] = compileBatchOrHelper.bind(null, 'helper');

///////////////////////////////////////////////////////////////////////////
// VASH.COMPILEBATCH
//
// Allow multiple templates to be contained within the same string.
// Templates are separated via a sourceURL-esque string:
//
// //@batch = tplname/or/path
//
// The separator is forgiving in terms of whitespace:
//
// // @      batch=tplname/or/path
//
// Is just as valid.
//
// Returns the compiled templates as named properties of an object.
exports['compileBatch'] = exports['batch'] = compileBatchOrHelper.bind(null, 'batch');

// HELPER AND BATCH COMPILATION
///////////////////////////////////////////////////////////////////////////

exports["VLexer"] = VLexer;
exports["VParser"] = VParser;
exports["VCompiler"] = VCompiler;
exports["vQuery"] = vQuery;
/*jshint strict:false, asi: false, laxcomma:true, laxbreak:true, boss:true, curly:true, node:true, browser:true, devel:true */
;(function(){

	vash = typeof vash === 'undefined' ? {} : vash;

	// only fully define if this is standalone
	if(!vash.compile){
		if(typeof define === 'function' && define['amd']){
			define(function(){ return vash }); // AMD
		} else if(typeof module === 'object' && module['exports']){
			module['exports'] = vash; // NODEJS
		} else {
			window['vash'] = vash; // BROWSER
		}
	}

	var helpers = vash['helpers'];

	var Helpers = function ( model ) {
		this.buffer = new Buffer();
		this.model  = model;
		this.options = null; // added at render time

		this.vl = 0;
		this.vc = 0;
	};

	vash['helpers']
		= helpers
		= Helpers.prototype
		= { constructor: Helpers, config: {}, tplcache: {} };

	// this allows a template to return the context, and coercion
	// will handle it
	helpers.toString = helpers.toHtmlString = function(){
		// not calling buffer.toString() results in 2x speedup
		return this.buffer._vo.join('');//.toString();
	}

	///////////////////////////////////////////////////////////////////////////
	// HTML ESCAPING

	var HTML_REGEX = /[&<>"'`]/g
		,HTML_REPLACER = function(match) { return HTML_CHARS[match]; }
		,HTML_CHARS = {
			"&": "&amp;"
			,"<": "&lt;"
			,">": "&gt;"
			,'"': "&quot;"
			,"'": "&#x27;"
			,"`": "&#x60;"
		};

	helpers['raw'] = function( val ) {
		var func = function() { return val; };

		val = val != null ? val : "";

		return {
			 toHtmlString: func
			,toString: func
		};
	};

	helpers['escape'] = function( val ) {
		var	func = function() { return val; };

		val = val != null ? val : "";

		if ( typeof val.toHtmlString !== "function" ) {

			val = val.toString().replace( HTML_REGEX, HTML_REPLACER );

			return {
				 toHtmlString: func
				,toString: func
			};
		}

		return val;
	};

	// HTML ESCAPING
	///////////////////////////////////////////////////////////////////////////


	///////////////////////////////////////////////////////////////////////////
	// BUFFER MANIPULATION
	//
	// These are to be used from within helpers, to allow for manipulation of
	// output in a sane manner.

	var Buffer = function() {
		this._vo = [];
	}

	Buffer.prototype.mark = function( debugName ) {
		var mark = new Mark( this, debugName );
		mark.markedIndex = this._vo.length;
		this._vo.push( mark.uid );
		return mark;
	};

	Buffer.prototype.fromMark = function( mark ) {
		var found = mark.findInBuffer();

		if( found > -1 ){
			// automatically destroy the mark from the buffer
			mark.destroy();
			// `found` will still be valid for a manual splice
			return this._vo.splice( found, this._vo.length );
		}

		return [];
	};

	Buffer.prototype.spliceMark = function( mark, numToRemove, add ){
		var found = mark.findInBuffer();

		if( found > -1 ){
			mark.destroy();
			arguments[0] = found;
			return this._vo.splice.apply( this._vo, arguments );
		}

		return [];
	};

	Buffer.prototype.empty = function() {
		return this._vo.splice( 0, this._vo.length );
	};

	Buffer.prototype.push = function( buffer ) {
		return this._vo.push( buffer );
	};

	Buffer.prototype.pushConcat = function( buffer ){
		var buffers;
		if (Array.isArray(buffer)) {
			buffers = buffer;
		} else if ( arguments.length > 1 ) {
			buffers = Array.prototype.slice.call( arguments );
		} else {
			buffers = [buffer];
		}

		for (var i = 0; i < buffers.length; i++) {
			this._vo.push( buffers[i] );
		}

		return this.__vo;
	}

	Buffer.prototype.indexOf = function( str ){

		for( var i = 0; i < this._vo.length; i++ ){
			if(
				( str.test && this._vo[i] && this._vo[i].search(str) > -1 )
				|| this._vo[i] == str
			){
				return i;
			}
		}

		return -1;
	}

	Buffer.prototype.lastIndexOf = function( str ){
		var i = this._vo.length;

		while( --i >= 0 ){
			if(
				( str.test && this._vo[i] && this._vo[i].search(str) > -1 )
				|| this._vo[i] == str
			){
				return i;
			}
		}

		return -1;
	}

	Buffer.prototype.splice = function(){
		return this._vo.splice.apply( this._vo, arguments );
	}

	Buffer.prototype.index = function( idx ){
		return this._vo[ idx ];
	}

	Buffer.prototype.flush = function() {
		return this.empty().join( "" );
	};

	Buffer.prototype.toString = Buffer.prototype.toHtmlString = function(){
		// not using flush because then console.log( tpl() ) would artificially
		// affect the output
		return this._vo.join( "" );
	}

	// BUFFER MANIPULATION
	///////////////////////////////////////////////////////////////////////////

	///////////////////////////////////////////////////////////////////////////
	// MARKS
	// These can be used to manipulate the existing entries in the rendering
	// context. For an example, see the highlight helper.

	var Mark = vash['Mark'] = function( buffer, debugName ){
		this.uid = '[VASHMARK-'
			+ ~~( Math.random() * 10000000 )
			+ (debugName ? ':' + debugName : '')
			+ ']';
		this.markedIndex = 0;
		this.buffer = buffer;
		this.destroyed = false;
	}

	var reMark = Mark.re = /\[VASHMARK\-\d{1,8}(?::[\s\S]+?)?]/g

	// tests if a string has a mark-like uid within it
	Mark.uidLike = function( str ){
		return (str || '').search( reMark ) > -1;
	}

	Mark.prototype.destroy = function(){

		var found = this.findInBuffer();

		if( found > -1 ){
			this.buffer.splice( found, 1 );
			this.markedIndex = -1;
		}

		this.destroyed = true;
	}

	Mark.prototype.findInBuffer = function(){

		if( this.destroyed ){
			return -1;
		}

		if( this.markedIndex && this.buffer.index( this.markedIndex ) === this.uid ){
			return this.markedIndex;
		}

		// The mark may be within a string due to string shenanigans. If this is
		// true this is bad, because all the Mark manipulation commands assume
		// that the Mark is the only content at that index in the buffer, which
		// means that splice commands will result in lost content.
		var escaped = this.uid.replace(/(\[|\])/g, '\\$1');
		var re = new RegExp(escaped);
		return this.markedIndex = this.buffer.indexOf( re );
	}

	// MARKS
	///////////////////////////////////////////////////////////////////////////

	///////////////////////////////////////////////////////////////////////////
	// ERROR REPORTING

	// Liberally modified from https://github.com/visionmedia/jade/blob/master/jade.js
	helpers.constructor.reportError = function(e, lineno, chr, orig, lb){

		lb = lb || '!LB!';

		var lines = orig.split(lb)
			,contextSize = lineno === 0 && chr === 0 ? lines.length - 1 : 3
			,start = Math.max(0, lineno - contextSize)
			,end = Math.min(lines.length, lineno + contextSize);

		var contextStr = lines.slice(start, end).map(function(line, i, all){
			var curr = i + start + 1;

			return (curr === lineno ? '  > ' : '    ')
				+ (curr < 10 ? ' ' : '')
				+ curr
				+ ' | '
				+ line;
		}).join('\n');

		e.vashlineno = lineno;
		e.vashcharno = chr;
		e.message = 'Problem while rendering template at line '
			+ lineno + ', character ' + chr
			+ '.\nOriginal message: ' + e.message + '.'
			+ '\nContext: \n\n' + contextStr + '\n\n';

		throw e;
	};

	helpers['reportError'] = function() {
		this.constructor.reportError.apply( this, arguments );
	};

	// ERROR REPORTING
	///////////////////////////////////////////////////////////////////////////

	///////////////////////////////////////////////////////////////////////////
	// VASH.LINK
	// Take a compiled string or function and "link" it to the current vash
	// runtime. This is necessary to allow instantiation of `Helpers` and
	// proper decompilation via `toClientString`.
	//
	// If `options.asHelper` and `options.args` are defined, the `cmpFunc` is
	// interpreted as a compiled helper, and is attached to `vash.helpers` at
	// a property name equal to `options.asHelper`.

	vash['link'] = function( cmpFunc, options ){

		// TODO: allow options.filename to be used as sourceUrl?

		var  originalFunc
			,cmpOpts;

		if( !options.args ){
			// every template has these arguments
			options.args = [options.modelName, options.helpersName, '__vopts', 'vash'];
		}

		if( typeof cmpFunc === 'string' ){
			originalFunc = cmpFunc;

			try {
				// do not pollute the args array for later attachment to the compiled
				// function for later decompilation/linking
				cmpOpts = options.args.slice();
				cmpOpts.push(cmpFunc);
				cmpFunc = Function.apply(null, cmpOpts);
			} catch(e) {
				// TODO: add flag to reportError to know if it's at compile time or runtime
				helpers.reportError(e, 0, 0, originalFunc, /\n/);
			}
		}

		// need this to enable decompilation / relinking
		cmpFunc.options = {
			 simple: options.simple
			,modelName: options.modelName
			,helpersName: options.helpersName
		}

		var linked;

		if( options.asHelper ){

			cmpFunc.options.args = options.args;
			cmpFunc.options.asHelper = options.asHelper;

			linked = function(){
				return cmpFunc.apply(this, slice.call(arguments));
			}

			helpers[options.asHelper] = linked;

		} else {

			linked = function( model, opts ){
				if( options.simple ){
					var ctx = {
						 buffer: []
						,escape: Helpers.prototype.escape
						,raw: Helpers.prototype.raw
					}
					return cmpFunc( model, ctx, opts, vash );
				}

				opts = divineRuntimeTplOptions( model, opts );
				return cmpFunc( model, (opts && opts.context) || new Helpers( model ), opts, vash );
			}
		}

		// show the template-specific code, instead of the generic linked function
		linked['toString'] = function(){ return cmpFunc.toString(); }

		// shortcut to show the actual linked function
		linked['_toString'] = function(){ return Function.prototype.toString.call(linked) }

		linked['toClientString'] = function(){
			return 'vash.link( '
				+ cmpFunc.toString() + ', '
				+ JSON.stringify( cmpFunc.options ) + ' )';
		}

		return linked;
	}

	// given a model and options, allow for various tpl signatures and options:
	// ( model, {} )
	// ( model, function onRenderEnd(){} )
	// ( model )
	// and model.onRenderEnd
	function divineRuntimeTplOptions( model, opts ){

		// allow for signature: model, callback
		if( typeof opts === 'function' ) {
			opts = { onRenderEnd: opts };
		}

		// allow for passing in onRenderEnd via model
		if( model && model.onRenderEnd ){
			opts = opts || {};

			if( !opts.onRenderEnd ){
				opts.onRenderEnd = model.onRenderEnd;
			}

			delete model.onRenderEnd;
		}

		// ensure options can be referenced
		if( !opts ){
			opts = {};
		}

		return opts;
	}

	// shortcut for compiled helpers
	var slice = Array.prototype.slice;

	// VASH.LINK
	///////////////////////////////////////////////////////////////////////////

	///////////////////////////////////////////////////////////////////////////
	// TPL CACHE

	vash['lookup'] = function( path, model ){
		var tpl = vash.helpers.tplcache[path];
		if( !tpl ){ throw new Error('Could not find template: ' + path); }
		if( model ){ return tpl(model); }
		else return tpl;
	};

	vash['install'] = function( path, tpl ){
		var cache = vash.helpers.tplcache;
		if( typeof tpl === 'string' ){
			if( !vash.compile ){ throw new Error('vash.install(path, [string]) is not available in the standalone runtime.') }
			tpl = vash.compile(tpl);
		} else if( typeof path === 'object' ){
			tpl = path;
			Object.keys(tpl).forEach(function(path){
				cache[path] = tpl[path];
			});
			return cache;
		}
		return cache[path] = tpl;
	};

	vash['uninstall'] = function( path ){
		var  cache = vash.helpers.tplcache
			,deleted = false;

		if( typeof path === 'string' ){
			return delete cache[path];
		} else {
			Object.keys(cache).forEach(function(key){
				if( cache[key] === path ){ deleted = delete cache[key]; }
			})
			return deleted;
		}
	};

}());
/*jshint strict:false, asi:true, laxcomma:true, laxbreak:true, boss:true, curly:true, node:true, browser:true, devel:true */
;(function(){

	var helpers = vash.helpers;

	// Trim whitespace from the start and end of a string
	helpers.trim = function(val){
		return val.replace(/^\s*|\s*$/g, '');
	}

	///////////////////////////////////////////////////////////////////////////
	// EXAMPLE HELPER: syntax highlighting

	helpers.config.highlighter = null;

	helpers.highlight = function(lang, cb){

		// context (this) is and instance of Helpers, aka a rendering context

		// mark() returns an internal `Mark` object
		// Use it to easily capture output...
		var startMark = this.buffer.mark();

		// cb() is simply a user-defined function. It could (and should) contain
		// buffer additions, so we call it...
		cb();

		// ... and then use fromMark() to grab the output added by cb().
		var cbOutLines = this.buffer.fromMark(startMark);

		// The internal buffer should now be back to where it was before this
		// helper started, and the output is completely contained within cbOutLines.

		this.buffer.push( '<pre><code>' );

		if( helpers.config.highlighter ){
			this.buffer.push( helpers.config.highlighter(lang, cbOutLines.join('')).value );
		} else {
			this.buffer.push( cbOutLines );
		}

		this.buffer.push( '</code></pre>' );

		// returning is allowed, but could cause surprising effects. A return
		// value will be directly added to the output directly following the above.
	}

}());
;(function(){


	///////////////////////////////////////////////////////////////////////////
	// LAYOUT HELPERS

	// semi hacky guard to prevent non-nodejs erroring
	if( typeof window === 'undefined' ){
		var  fs = require('fs')
			,path = require('path')
	}

	var helpers = vash.helpers;

	// TRUE implies that all TPLS are loaded and waiting in cache
	helpers.config.browser = false;

	vash.loadFile = function(filepath, options, cb){

		// options are passed in via Express
		// {
		//   settings:
		//   {
		//      env: 'development',
		//   	'jsonp callback name': 'callback',
		//   	'json spaces': 2,
		//   	views: '/Users/drew/Dropbox/js/vash/test/fixtures/views',
		//   	'view engine': 'vash'
		//   },
		//   _locals: [Function: locals],
		//   cache: false
		// }

		// The only required options are:
		//
		// settings: {
		//     views: ''
		// }

		// extend works from right to left, using first arg as target
		options = vQuery.extend( {}, vash.config, options || {} );

		var browser = helpers.config.browser
			,tpl

		if( !browser && options.settings && options.settings.views ){
			// this will really only have an effect on windows
			filepath = path.normalize( filepath );

			if( filepath.indexOf( path.normalize( options.settings.views ) ) === -1 ){
				// not an absolute path
				filepath = path.join( options.settings.views, filepath );
			}

			if( !path.extname( filepath ) ){
				filepath += '.' + ( options.settings['view engine'] || 'vash' )
			}
		}

		// TODO: auto insert 'model' into arguments
		try {
			// if browser, tpl must exist in tpl cache
			tpl = options.cache || browser
				? helpers.tplcache[filepath] || ( helpers.tplcache[filepath] = vash.compile(fs.readFileSync(filepath, 'utf8')) )
				: vash.compile( fs.readFileSync(filepath, 'utf8') )

			cb && cb(null, tpl);
		} catch(e) {
			cb && cb(e, null);
		}
	}

	vash.renderFile = function(filepath, options, cb){

		vash.loadFile(filepath, options, function(err, tpl){
			// auto setup an `onRenderEnd` callback to seal the layout
			var prevORE = options.onRenderEnd;

			cb( err, !err && tpl(options, function(err, ctx){
				ctx.finishLayout()
				if( prevORE ) prevORE(err, ctx);
			}) );
		})
	}

	helpers._ensureLayoutProps = function(){
		this.appends = this.appends || {};
		this.prepends = this.prepends || {};
		this.blocks = this.blocks || {};

		this.blockMarks = this.blockMarks || {};
	}

	helpers.finishLayout = function(){
		this._ensureLayoutProps();

		var self = this, name, marks, blocks, prepends, appends, injectMark, m, content

		// each time `.block` is called, a mark is added to the buffer and
		// the `blockMarks` stack. Find the newest/"highest" mark on the stack
		// for each named block, and insert the rendered content (prepends, block, appends)
		// in place of that mark

		for( name in this.blockMarks ){

			marks = this.blockMarks[name];

			prepends = this.prepends[name];
			blocks = this.blocks[name];
			appends = this.appends[name];

			injectMark = marks.pop();

			// mark current point in buffer in prep to grab rendered content
			m = this.buffer.mark();

			prepends && prepends.forEach(function(p){ self.buffer.pushConcat( p ); });

			// a block might never have a callback defined, e.g. is optional
			// with no default content
			block = blocks.pop();
			block && this.buffer.pushConcat( block );

			appends && appends.forEach(function(a){ self.buffer.pushConcat( a ); });

			// grab rendered content
			content = this.buffer.fromMark( m )

			// Join, but split out the VASHMARKS so further buffer operations are still
			// sane. Join is required to prevent max argument errors when large templates
			// are being used.
			content = compactContent(content);

			// Prep for apply, ensure the right location (mark) is used for injection.
			content.unshift( injectMark, 0 );
			this.buffer.spliceMark.apply( this.buffer, content );
		}

		for( name in this.blockMarks ){

			// kill all other marks registered as blocks
			this.blockMarks[name].forEach(function(m){ m.destroy(); });
		}

		// this should only be able to happen once
		delete this.blockMarks;
		delete this.prepends;
		delete this.blocks;
		delete this.appends;

		// and return the whole thing
		return this.toString();
	}

	// Given an array, condense all the strings to as few array elements
	// as possible, while preserving `Mark`s as individual elements.
	function compactContent(content) {
		var re = vash.Mark.re;
		var parts = [];
		var str = '';

		content.forEach(function(part) {
			if (re.exec(part)) {
				parts.push(str, part);
				str = '';
			} else {
				// Ensure `undefined`s are not `toString`ed
				str += (part || '');
			}
		});

		// And don't forget the rest.
		parts.push(str);

		return parts;
	}

	helpers.extend = function(path, ctn){
		var  self = this
			,buffer = this.buffer
			,origModel = this.model
			,layoutCtx;

		this._ensureLayoutProps();

		// this is a synchronous callback
		vash.loadFile(path, this.model, function(err, tpl){

			// any content that is outside of a block but within an "extend"
			// callback is completely thrown away, as the destination for such
			// content is undefined
			var start = self.buffer.mark();

			ctn(self.model);

			// ... and just throw it away
			var  content = self.buffer.fromMark( start )
				// TODO: unless it's a mark id? Removing everything means a block
				// MUST NOT be defined in an extend callback
				//,filtered = content.filter( vash.Mark.uidLike )

			//self.buffer.push( filtered );

			// `isExtending` is necessary because named blocks in the layout
			// will be interpreted after named blocks in the content. Since
			// layout named blocks should only be used as placeholders in the
			// event that their content is redefined, `block` must know to add
			// the defined content at the head or tail or the block stack.
			self.isExtending = true;
			tpl( self.model, { context: self } );
			self.isExtending = false;
		});

		this.model = origModel;
	}

	helpers.include = function(name, model){

		var  self = this
			,buffer = this.buffer
			,origModel = this.model;

		// TODO: should this be in a new context? Jade looks like an include
		// is not shared with parent context

		// this is a synchronous callback
		vash.loadFile(name, this.model, function(err, tpl){
			tpl( model || self.model, { context: self } );
		});

		this.model = origModel;
	}

	helpers.block = function(name, ctn){
		this._ensureLayoutProps();

		var  self = this
			// ensure that we have a list of marks for this name
			,marks = this.blockMarks[name] || ( this.blockMarks[name] = [] )
			// ensure a list of blocks for this name
			,blocks = this.blocks[name] || ( this.blocks[name] = [] )
			,start
			,content;

		// render out the content immediately, if defined, to attempt to grab
		// "dependencies" like other includes, blocks, etc
		if( ctn ){
			start = this.buffer.mark();
			ctn( this.model );
			content = this.buffer.fromMark( start );

			// add rendered content to named list of blocks
			if( content.length && !this.isExtending ){
				blocks.push( content );
			}

			// if extending the rendered content must be allowed to be redefined
			if( content.length && this.isExtending ){
				blocks.unshift( content );
			}
		}

		// mark the current location as "where this block will end up"
		marks.push( this.buffer.mark( 'block-' + name ) );
	}

	helpers._handlePrependAppend = function( type, name, ctn ){
		this._ensureLayoutProps();

		var start = this.buffer.mark()
			,content
			,stack = this[type]
			,namedStack = stack[name] || ( stack[name] = [] )

		ctn( this.model );
		content = this.buffer.fromMark( start );

		namedStack.push( content );
	}

	helpers.append = function(name, ctn){
		this._handlePrependAppend( 'appends', name, ctn );
	}

	helpers.prepend = function(name, ctn){
		this._handlePrependAppend( 'prepends', name, ctn );
	}

}());
exports.__express = exports.renderFile;
	return exports;
}({ "version": "0.7.12-1" }));
},{"fs":7,"path":8}],14:[function(require,module,exports){
/* canvas-toBlob.js
 * A canvas.toBlob() implementation.
 * 2013-12-27
 * 
 * By Eli Grey, http://eligrey.com and Devin Samarin, https://github.com/eboyjr
 * License: X11/MIT
 *   See https://github.com/eligrey/canvas-toBlob.js/blob/master/LICENSE.md
 */

/*global self */
/*jslint bitwise: true, regexp: true, confusion: true, es5: true, vars: true, white: true,
  plusplus: true */

/*! @source http://purl.eligrey.com/github/canvas-toBlob.js/blob/master/canvas-toBlob.js */

(function(view) {
"use strict";
var
    Uint8Array = view.Uint8Array
  , HTMLCanvasElement = view.HTMLCanvasElement
  , canvas_proto = HTMLCanvasElement && HTMLCanvasElement.prototype
  , is_base64_regex = /\s*;\s*base64\s*(?:;|$)/i
  , to_data_url = "toDataURL"
  , base64_ranks
  , decode_base64 = function(base64) {
    var
        len = base64.length
      , buffer = new Uint8Array(len / 4 * 3 | 0)
      , i = 0
      , outptr = 0
      , last = [0, 0]
      , state = 0
      , save = 0
      , rank
      , code
      , undef
    ;
    while (len--) {
      code = base64.charCodeAt(i++);
      rank = base64_ranks[code-43];
      if (rank !== 255 && rank !== undef) {
        last[1] = last[0];
        last[0] = code;
        save = (save << 6) | rank;
        state++;
        if (state === 4) {
          buffer[outptr++] = save >>> 16;
          if (last[1] !== 61 /* padding character */) {
            buffer[outptr++] = save >>> 8;
          }
          if (last[0] !== 61 /* padding character */) {
            buffer[outptr++] = save;
          }
          state = 0;
        }
      }
    }
    // 2/3 chance there's going to be some null bytes at the end, but that
    // doesn't really matter with most image formats.
    // If it somehow matters for you, truncate the buffer up outptr.
    return buffer;
  }
;
if (Uint8Array) {
  base64_ranks = new Uint8Array([
      62, -1, -1, -1, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1
    , -1, -1,  0, -1, -1, -1,  0,  1,  2,  3,  4,  5,  6,  7,  8,  9
    , 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25
    , -1, -1, -1, -1, -1, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35
    , 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
  ]);
}
if (HTMLCanvasElement && !canvas_proto.toBlob) {
  canvas_proto.toBlob = function(callback, type /*, ...args*/) {
      if (!type) {
      type = "image/png";
    } if (this.mozGetAsFile) {
      callback(this.mozGetAsFile("canvas", type));
      return;
    } if (this.msToBlob && /^\s*image\/png\s*(?:$|;)/i.test(type)) {
      callback(this.msToBlob());
      return;
    }

    var
        args = Array.prototype.slice.call(arguments, 1)
      , dataURI = this[to_data_url].apply(this, args)
      , header_end = dataURI.indexOf(",")
      , data = dataURI.substring(header_end + 1)
      , is_base64 = is_base64_regex.test(dataURI.substring(0, header_end))
      , blob
    ;
    if (Blob.fake) {
      // no reason to decode a data: URI that's just going to become a data URI again
      blob = new Blob
      if (is_base64) {
        blob.encoding = "base64";
      } else {
        blob.encoding = "URI";
      }
      blob.data = data;
      blob.size = data.length;
    } else if (Uint8Array) {
      if (is_base64) {
        blob = new Blob([decode_base64(data)], {type: type});
      } else {
        blob = new Blob([decodeURIComponent(data)], {type: type});
      }
    }
    callback(blob);
  };

  if (canvas_proto.toDataURLHD) {
    canvas_proto.toBlobHD = function() {
      to_data_url = "toDataURLHD";
      var blob = this.toBlob();
      to_data_url = "toDataURL";
      return blob;
    }
  } else {
    canvas_proto.toBlobHD = canvas_proto.toBlob;
  }
}
}(typeof self !== "undefined" && self || typeof window !== "undefined" && window || this.content || this));

},{}],15:[function(require,module,exports){
// Originally from https://www.npmjs.org/package/exif-rotate, but with
// component dependencies manually inlined.

/**
 * Module dependencies.
 */

var rotate = function(ctx, o){
  var x = o.x || 0;
  var y = o.y || 0;

  if (o.degrees) {
    o.radians = o.degrees * (Math.PI / 180);
  }

  ctx.translate(x, y);
  ctx.rotate(o.radians);
  ctx.translate(-x, -y);
};

var flip = function(canvas, x, y){
  var ctx = canvas.getContext('2d');

  ctx.translate(
    x ? canvas.width : 0,
    y ? canvas.height : 0);

  ctx.scale(
    x ? -1 : 1,
    y ? -1 : 1);
};

/**
 * Expose `orient`.
 */

module.exports = orient;

/**
 * Orientations.
 */

var orientations = [
  { op: 'none', degrees: 0 },
  { op: 'flip-x', degrees: 0 },
  { op: 'none', degrees: 180 },
  { op: 'flip-y', degrees: 0 },
  { op: 'flip-x', degrees: 90 },
  { op: 'none', degrees: 90 },
  { op: 'flip-x', degrees: -90 },
  { op: 'none', degrees: -90 }
];

/**
 * Rotate `img` with orientation `n` when necessary.
 *
 * The `img` dimensions are updated as necessary to
 * reflect the rotation applied.
 *
 * @param {Image} img
 * @param {Number} n
 * @return {String} data uri
 */

function orient(img, n) {
  var o = orientations[n - 1];

  // canvas
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  // dims
  if (rotated(n)) {
    canvas.height = img.width;
    canvas.width = img.height;
  } else {
    canvas.width = img.width;
    canvas.height = img.height;
  }

  // flip
  if ('flip-x' == o.op) flip(canvas, true, false);
  if ('flip-y' == o.op) flip(canvas, false, true);

  // rotate
  if (o.degrees) {
    rotate(ctx, {
      degrees: o.degrees,
      x: canvas.width / 2,
      y: canvas.height / 2
    });

    if (rotated(n)) {
      var d = canvas.width - canvas.height;
      ctx.translate(d / 2, -d / 2);
    }
  }

  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * Check if we need to change dims.
 */

function rotated(n) {
  return !! ~[5,6,7,8].indexOf(n);
}


},{}]},{},[1]);
