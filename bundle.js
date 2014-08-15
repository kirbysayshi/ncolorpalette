(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

// Polyfill auto attached self to canvas proto if needed.
require('./vendor/canvas-toBlob');

var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');

var currentConvergence = null;

function current() {

  var q = document.querySelector.bind(document);

  return {

    // Defaults/Constants
    ASYNC_AREA_LIMIT: 120000,

    // DOM Options
    palette: palettes[q('[name=options-palettes]:checked').value],
    image: q('#img-input'),
    dstCvs: q('#cvs-n-color-rgb'),
    async: q('#options-async').checked,
    dstImg: q('#img-output')
  }
}

function now() {
  return window.performance
    ? window.performance.now()
    : Date.now();
}

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
  console.log('drop', e);
  document.body.classList.remove('drag-valid');

  var files = e.dataTransfer.files;

  if (!files[0]) {
    throw new Error('No files or invalid file was dropped.');
  }

  var reader = new FileReader();
  reader.readAsDataURL(files[0]);
  reader.addEventListener('loadend', function() {

    var c = current();
    c.image.src = reader.result;
    c.image.addEventListener('load', function load(e) {
      c.image.removeEventListener('load', load);
      console.log('input display ready');
      redraw(c);
    })
  })

  e.stopPropagation();
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
  var clusterCount = palette.length / dataFactor; // Assume rgba for now.
  var clusterData = Clusterer.init(srcData.data, clusterCount, dataFactor);

  // Init output data.
  var outputImageData = dstCtx.createImageData(srcData);

  var convergeStart = now();
  currentConvergence = converge(clusterData, async, progress, complete);

  function progress(clusterData, convergeCount, pixelsMoved) {
    console.log('converge', convergeCount, async == true ? 'ASYNC' : 'SYNC', pixelsMoved);
    Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);
  }

  function complete(err, clusterData, convergeCount) {

    var time = now() - convergeStart;

    document.querySelector('#output-stats').textContent =
      '(' + convergeCount + ' iterations, ' + time.toFixed(2) + 'ms)';

    console.log('converged in', convergeCount, time + 'ms');
    Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);

    dstCvs.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      dstImg.addEventListener('load', function onload() {
        URL.revokeObjectURL(url);
        dstImg.removeEventListener('load', onload);
      })
      dstImg.src = url;
    })

    // Hide canvas, show image to allow for dragging out of the browser.
    setTimeout(function() {
      dstCvs.style.display = 'none';
      dstImg.style.display = 'block';

      if (opt_cb) opt_cb.apply(null, arguments);
    })
  }
}
},{"./lib/clusterer":3,"./lib/converge":4,"./lib/palettes":5,"./vendor/canvas-toBlob":6}],2:[function(require,module,exports){
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

exports.gameboy = [
  0, 60, 16, 255,
  6, 103, 49, 255,
  123, 180, 0, 255,
  138, 196, 0, 255
]

exports['special-beam-cannon-cell'] = [
  0, 0, 60, 255, // deep blue
  83, 13, 65, 255, // purple
  157, 37, 83, 255, // magenta
  //0, 0, 0, 255, // black,
  252, 226, 0, 255 // yellow
]

exports['special-beam-cannon'] = [
  58, 12, 97, 255, // deep purple
  170, 25, 174, 255, // bright purple
  244, 59, 175, 255, // magenta
  254, 251, 83, 255 // yellow
  //254, 251, 231, 255 // white
]

exports.goku = [
  27, 49, 197, 255, // blue cuffs
  23, 102, 118, 255, // ss iris
  213, 89, 0, 255, // orange gi
  250, 200, 203, 255, // skin
  233, 202, 86, 255, // ss eyebrows
  255, 234, 255, 255 // ss hair highlights
]

  // http://www.colourlovers.com/palette/1652329/Muted_Kirby
exports['muted-kirby'] = [
  34, 42, 79, 255,
  172, 95, 139, 255,
  207, 122, 122, 255,
  251, 217, 216, 255/*,
  255, 255, 255, 255*/
]
},{}],6:[function(require,module,exports){
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

},{}]},{},[1]);
