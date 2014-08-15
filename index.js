
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