var Clusterer = require('./lib/clusterer');
var converge = require('./lib/converge');
var palettes = require('./lib/palettes');

var cvsOutputRgb = document.getElementById('cvs-n-color-rgb');

function current() {

  var q = document.querySelector.bind(document);

  return {
    palette: palettes[q('[name=options-palettes]:checked').value],
    image: q('#img-input'),
    dstCvs: q('#cvs-n-color-rgb'),
    async: q('#options-async').checked
  }
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
      redraw(c.image, c.dstCvs, c.palette);
    })
  })

  e.preventDefault();
  e.stopPropagation();
}, false)

// Listen to options
document.addEventListener('change', function(e) {
  var c = current();

  if (!c.image.src) return;

  redraw(c.image, c.dstCvs, c.palette);
})

function redraw(srcImg, dstCvs, palette, opt_cb) {
  var dstCtx = dstCvs.getContext('2d');

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

  var ASYNC_AREA_LIMIT = 120000;

  var srcArea = srcData.width * srcData.height;
  var async = srcArea > ASYNC_AREA_LIMIT
    ? true
    : false;

  var convergeStart = window.performance.now();
  converge(clusterData, async, progress, complete);

  function progress(clusterData, convergeCount, pixelsMoved) {
    console.log('converge', convergeCount, async == true ? 'ASYNC' : 'SYNC', pixelsMoved);
    Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);
  }

  function complete(err, clusterData, convergeCount) {
    console.log('converged in', convergeCount, (window.performance.now() - convergeStart) + 'ms');
    Clusterer.applyPaletteToImageData(clusterData, palette, outputImageData);
    dstCtx.putImageData(outputImageData, 0, 0);
    if (opt_cb) opt_cb.apply(null, arguments);
  }
}