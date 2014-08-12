(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');

var cvsOutputRgb = document.getElementById('cvs-n-color-rgb');
var ctxOutputRgb = cvsOutputRgb.getContext('2d');

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
  console.log('drop', e);
  document.body.classList.remove('drag-valid');

  var files = e.dataTransfer.files;

  if (!files[0]) {
    throw new Error('No files or invalid file was dropped.');
  }

  var reader = new FileReader();
  reader.readAsDataURL(files[0]);
  reader.addEventListener('loadend', function() {
    var imgInput = document.createElement('img');
    imgInput.src = reader.result;
    imgInput.addEventListener('load', function load(e) {
      imgInput.removeEventListener('load', load);
      console.log('input display ready');

      cvsOutputRgb.width = imgInput.width;
      cvsOutputRgb.height = imgInput.height;

      ctxOutputRgb.drawImage(imgInput, 0, 0);

      var imgData = ctxOutputRgb.getImageData(0, 0, imgInput.width, imgInput.height);
      var clusterCount = 4; // TODO: this should come from palette
      var clusterData = Clusterer.init(imgData.data, clusterCount, 4);

      var async = false;
      var ASYNC_AREA_LIMIT = 120000;

      if (imgData.width * imgData.height > ASYNC_AREA_LIMIT) {
        async = true;
      }

      var convergeStart = window.performance.now();
      var palette = palettes.gameboy.slice(0);
      var outputImageData = ctxOutputRgb.createImageData(imgData);

      converge(clusterData, async,
        function progress(clusterData, convergeCount, pixelsMoved) {
          console.log('converge', convergeCount, async == true ? 'ASYNC' : 'SYNC', pixelsMoved);
          Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
          ctxOutputRgb.putImageData(outputImageData, 0, 0);
        },
        function(err, clusterData, convergeCount) {
          console.log('converged in', convergeCount, (window.performance.now() - convergeStart) + 'ms');
          Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
          ctxOutputRgb.putImageData(outputImageData, 0, 0);
        })
    })
  })

  e.preventDefault();
  e.stopPropagation();
}, false)
},{"./lib/clusterer":3,"./lib/converge":4,"./lib/palettes":5}],2:[function(require,module,exports){
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
    asyncConverge(clusterData, progress, cb);
  } else {
    syncConverge(clusterData, progress, cb);
  }
}

function asyncConverge(clusterData, progress, cb) {
  var convergeCount = 0;

  (function next() {
    setTimeout(function() {
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
  0, 0, 0, 255, // black,
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
},{}]},{},[1]);
