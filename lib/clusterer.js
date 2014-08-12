
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