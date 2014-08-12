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